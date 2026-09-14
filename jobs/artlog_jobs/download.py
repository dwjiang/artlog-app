"""Download corpus images into scratch one shard at a time, each source at its polite
rate, resized so no original is ever kept."""

import argparse
import hashlib
import json
import logging
import sys
import threading
import time
from collections.abc import Callable, Iterable, Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from urllib.parse import quote, unquote, urlencode

import httpx
from PIL import Image, ImageOps, UnidentifiedImageError

from .config import Settings, get_settings, setup_logging
from .polite_http import BandwidthLimiter, PoliteClient, RetryLater

log = logging.getLogger(__name__)

SHARD_SIZE = 10_000
MAX_SIDE = 1024
JPEG_QUALITY = 90
COMMONS_THUMB_WIDTH = 960
# Standard thumbnail steps at or below the default (mediawiki.org "Common thumbnail sizes").
# A file no wider than the requested width comes back as its original, and
# upload.wikimedia.org throttles originals far harder than thumbnails: every 429 seen across
# three runs (20 of 20) hit an original while originals were a third of the requests.
COMMONS_THUMB_STEPS = (960, 500, 330, 250, 120, 60, 40, 20)
COMMONS_FILE_PATH = "https://commons.wikimedia.org/wiki/Special:FilePath/"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
COMMONS_TITLES_PER_CALL = 50
COMMONS_QUERY_BYTES = 6000
RESOLVE_BATCH = 50
ATTEMPTS = 3
BACKOFF_SECONDS = 2.0
MAX_COOLDOWN_SECONDS = 600.0
CONSECUTIVE_DENIALS_LIMIT = 20
PERMANENT_STATUSES = frozenset({400, 401, 403, 404, 410, 451})
# Wikimedia media rules (Wikitech robot policy, read 2026-09-10): total concurrency ≤ 2 and
# ≤ 25 Mbps over 10 s windows, standard thumbnail sizes, thumbnails preferred; the action API
# (imageinfo): concurrency 1, < 5 req/s. Thumbnail requests at ≈ 3 req/s across both streams
# ran without a 429 (2026-09-10), so the media rate is capped at 4. Met CDN documented ceiling
# is 20 req/s; AIC: a single stream at ≤ 1 req/s with its identifying header.
SOURCE_RATES = {"met": 8.0, "aic": 1.0, "wikidata": 4.0}
SOURCE_STREAMS = {"met": 1, "aic": 1, "wikidata": 2}
WIKIMEDIA_MBPS = 25.0


class DownloadIncomplete(RuntimeError):
    pass


class SourceBlocked(DownloadIncomplete):
    """A source answered with consecutive 403/429s; halve its rate and report (STOP)."""


@dataclass(frozen=True)
class ImageTask:
    key: str
    url: str
    source: str


@dataclass
class SourceReport:
    attempted: int = 0
    done: int = 0
    failed: int = 0
    skipped: int = 0
    seconds: float = 0.0
    statuses: dict[str, int] = field(default_factory=dict)
    retries: int = 0
    retryable: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)

    @property
    def rate(self) -> float:
        return (self.done + self.failed) / self.seconds if self.seconds else 0.0

    def count_status(self, status: int) -> None:
        with self.lock:
            self.statuses[str(status)] = self.statuses.get(str(status), 0) + 1

    def count_retry(self) -> None:
        with self.lock:
            self.retries += 1

    def as_dict(self) -> dict:
        return {
            "attempted": self.attempted,
            "done": self.done,
            "failed": self.failed,
            "skipped": self.skipped,
            "seconds": self.seconds,
            "statuses": dict(self.statuses),
            "retries": self.retries,
            "retryable": self.retryable,
            "rate": round(self.rate, 3),
        }


def source_of(key: str) -> str:
    source = key.split(":", 1)[0]
    if source not in SOURCE_RATES:
        raise ValueError(f"no download policy for source {source!r} ({key})")
    return source


def commons_title(url: str) -> str:
    if not url.startswith(COMMONS_FILE_PATH):
        raise ValueError(f"not a Commons file path: {url}")
    return "File:" + unquote(url.removeprefix(COMMONS_FILE_PATH))


def commons_batches(tasks: list[ImageTask]) -> Iterator[list[ImageTask]]:
    """≤ 50 titles per API call (the anonymous limit) and a GET-safe query length."""
    batch: list[ImageTask] = []
    length = 0
    for task in tasks:
        cost = len(quote(commons_title(task.url))) + 3
        if batch and (len(batch) == COMMONS_TITLES_PER_CALL or length + cost > COMMONS_QUERY_BYTES):
            yield batch
            batch, length = [], 0
        batch.append(task)
        length += cost
    if batch:
        yield batch


def query_imageinfo(
    client: PoliteClient, titles: list[str], width: int
) -> tuple[dict[str, str], dict[str, dict]]:
    """One `imageinfo` call: title aliases (normalized and redirected) and pages by title."""
    query = urlencode(
        {
            "action": "query",
            "prop": "imageinfo",
            "iiprop": "url|size",
            "iiurlwidth": width,
            "titles": "|".join(titles),
            "redirects": 1,
            "format": "json",
            "formatversion": 2,
        }
    )
    response = client.get(f"{COMMONS_API}?{query}")
    response.raise_for_status()
    data = response.json()["query"]
    aliases = {entry["from"]: entry["to"] for entry in data.get("normalized", [])}
    aliases.update({entry["from"]: entry["to"] for entry in data.get("redirects", [])})
    return aliases, {page["title"]: page for page in data.get("pages", [])}


def thumbnail_step(width: int | None) -> int:
    """The largest standard step strictly narrower than the file, so the fetch is always a
    thumbnail; unknown widths and files narrower than every step keep the default."""
    if width is None:
        return COMMONS_THUMB_WIDTH
    return next((step for step in COMMONS_THUMB_STEPS if step < width), COMMONS_THUMB_WIDTH)


def resolve_commons(client: PoliteClient, tasks: list[ImageTask]) -> dict[str, str | None]:
    """Map object keys to `upload.wikimedia.org` thumbnail URLs through `imageinfo`:
    one API call per batch instead of two redirect hops per file, a
    server-rendered standard width for TIFF/PDF/SVG originals, and a narrower step for
    files the default width would return as originals. Missing files map to None."""
    resolved: dict[str, str | None] = {}
    for batch in commons_batches(tasks):
        titles = sorted({commons_title(task.url) for task in batch})
        aliases, pages = query_imageinfo(client, titles, COMMONS_THUMB_WIDTH)
        narrower: dict[int, list[str]] = {}
        for title, page in pages.items():
            if page.get("missing"):
                continue
            info = (page.get("imageinfo") or [{}])[0]
            step = thumbnail_step(info.get("width"))
            if step != COMMONS_THUMB_WIDTH:
                narrower.setdefault(step, []).append(title)
        for step, subset in sorted(narrower.items(), reverse=True):
            pages.update(query_imageinfo(client, sorted(subset), step)[1])
        for task in batch:
            title = commons_title(task.url)
            for _ in range(3):
                title = aliases.get(title, title)
            page = pages.get(title)
            info = (page or {}).get("imageinfo") or [{}]
            url = (
                None
                if page is None or page.get("missing")
                else info[0].get("thumburl") or info[0].get("url")
            )
            resolved[task.key] = url
    return resolved


def resolve_urls(
    source: str, client: PoliteClient, tasks: list[ImageTask]
) -> dict[str, str | None]:
    if source == "wikidata":
        return resolve_commons(client, tasks)
    return {task.key: task.url for task in tasks}


def image_filename(key: str) -> str:
    return quote(key, safe="") + ".jpg"


def key_from_filename(name: str) -> str:
    return unquote(name.removesuffix(".jpg"))


def order_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def iter_tasks(objects_path: Path) -> Iterator[ImageTask]:
    with Path(objects_path).open() as body:
        for line in body:
            row = json.loads(line)
            if row.get("imageRef"):
                yield ImageTask(row["key"], row["imageRef"], source_of(row["key"]))


def task_fingerprint(tasks: Iterable[ImageTask]) -> str:
    digest = hashlib.sha256()
    for key, url in sorted((task.key, task.url) for task in tasks):
        digest.update((json.dumps([key, url], ensure_ascii=False) + "\n").encode())
    return digest.hexdigest()


def plan_shards(
    tasks: Iterable[ImageTask], *, shard_size: int = SHARD_SIZE, limit: int | None = None
) -> list[list[ImageTask]]:
    """Hash order is deterministic and interleaves sources, so any prefix (a `--limit`) and
    every shard sample all sources alike."""
    if shard_size <= 0:
        raise ValueError("shard_size must be positive")
    ordered = sorted(tasks, key=lambda task: order_key(task.key))
    if limit is not None:
        ordered = ordered[:limit]
    return [ordered[i : i + shard_size] for i in range(0, len(ordered), shard_size)]


def resize_to_jpeg(data: bytes) -> bytes:
    with Image.open(BytesIO(data)) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
    image.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)
    buffer = BytesIO()
    image.save(buffer, "JPEG", quality=JPEG_QUALITY)
    return buffer.getvalue()


def write_atomic(path: Path, data: bytes) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(data)
    temporary.replace(path)


class ShardState:
    """Per-source progress and terminal failures; missing images remain pending on resume."""

    def __init__(self, state_dir: Path, shard: int):
        self.path = Path(state_dir) / f"shard-{shard}.json"
        self.failed_path = Path(state_dir) / f"shard-{shard}-failed.jsonl"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.data = json.loads(self.path.read_text()) if self.path.exists() else {}
        self.data.setdefault("shard", shard)
        self.data.setdefault("sources", {})
        self.failed: dict[str, str] = {}
        if self.failed_path.exists():
            with self.failed_path.open() as body:
                for line in body:
                    row = json.loads(line)
                    self.failed[row["key"]] = row["reason"]
        self._lock = threading.Lock()

    @property
    def complete(self) -> bool:
        return bool(self.data.get("complete"))

    def bind_inputs(self, tasks: list[ImageTask], images_dir: Path) -> None:
        if self.path.exists() or self.failed_path.exists() or any(images_dir.iterdir()):
            self.require_inputs(tasks)
            return
        self.data["downloadInputsSha256"] = task_fingerprint(tasks)
        self._save()

    def require_inputs(self, tasks: list[ImageTask]) -> None:
        if self.data.get("downloadInputsSha256") != task_fingerprint(tasks):
            raise ValueError(
                f"{self.path}: missing or mismatched download inputs fingerprint; "
                "use fresh image and download-state directories"
            )

    def require_complete(self, tasks: list[ImageTask], images_dir: Path) -> None:
        self.require_inputs(tasks)
        expected = {image_filename(task.key) for task in tasks if task.key not in self.failed}
        present = {path.name for path in images_dir.glob("*.jpg") if path.is_file()}
        if not self.complete or not images_dir.is_dir() or expected != present:
            raise DownloadIncomplete(
                f"{images_dir}: incomplete download; {len(expected - present)} missing images, "
                f"{len(present - expected)} unexpected images. Resume the download stage first."
            )

    def record_failure(self, task: ImageTask, reason: str, status: int | None) -> None:
        with self._lock:
            self.failed[task.key] = reason
            with self.failed_path.open("a") as body:
                body.write(
                    json.dumps(
                        {
                            "key": task.key,
                            "url": task.url,
                            "source": task.source,
                            "reason": reason,
                            "status": status,
                        }
                    )
                    + "\n"
                )

    def save_source(self, source: str, report: SourceReport, *, complete: bool) -> None:
        with self._lock:
            self.data["sources"][source] = {**report.as_dict(), "complete": complete}
            if not complete:
                self.data["complete"] = False
            self._save()

    def finish(self, tasks_by_source: dict[str, list[ImageTask]]) -> None:
        with self._lock:
            self.data["complete"] = all(
                self.data["sources"].get(source, {}).get("complete") for source in tasks_by_source
            )
            self.data["finishedAt"] = datetime.now(UTC).isoformat()
            self._save()

    def _save(self) -> None:
        temporary = self.path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(self.data, indent=2) + "\n")
        temporary.replace(self.path)


ClientFactory = Callable[[str], PoliteClient]


def default_client_factory(settings: Settings, rates: dict[str, float]) -> ClientFactory:
    def make(source: str) -> PoliteClient:
        # Designated media endpoints of admitted sources, not site crawling;
        # the same footing as sources/fetch.py's dump downloads.
        return PoliteClient(
            user_agent=settings.user_agent,
            per_host_rps=rates[source],
            robots=False,
            cache_max_bytes=0,
            timeout=60,
        )

    return make


def fetch_one(
    client: PoliteClient,
    task: ImageTask,
    url: str,
    destination: Path,
    report: SourceReport,
    *,
    sleep: Callable[[float], None] = time.sleep,
    limiter: BandwidthLimiter | None = None,
) -> tuple[str, str | None, int | None]:
    """Returns ('done' | 'failed', reason, http status)."""
    headers = {"AIC-User-Agent": client.user_agent} if task.source == "aic" else None
    last_status: int | None = None
    for attempt in range(ATTEMPTS):
        if attempt:
            report.count_retry()
            sleep(BACKOFF_SECONDS * 2 ** (attempt - 1))
        try:
            response = client.get(url, headers=headers, limiter=limiter)
        except RetryLater as cooldown:
            last_status = cooldown.status_code
            report.count_status(last_status)
            if cooldown.retry_after > MAX_COOLDOWN_SECONDS:
                return "failed", "cooldown_too_long", last_status
            log.warning("%s cooling down %.0fs for %s", task.source, cooldown.retry_after, task.key)
            sleep(cooldown.retry_after)
            continue
        except httpx.TransportError as error:
            log.warning("%s transport error for %s: %s", task.source, task.key, error)
            return "failed", "transient_exhausted", None
        last_status = response.status_code
        report.count_status(last_status)
        if response.status_code == 200:
            try:
                data = resize_to_jpeg(response.content)
            except Image.DecompressionBombError:
                return "failed", "decompression_bomb", 200
            except (UnidentifiedImageError, OSError, ValueError):
                return "failed", "decode_error", 200
            write_atomic(destination, data)
            return "done", None, 200
        if response.status_code in PERMANENT_STATUSES:
            return "failed", f"http_{response.status_code}", response.status_code
    return "failed", "transient_exhausted", last_status


def download_source(
    source: str,
    tasks: list[ImageTask],
    *,
    images_dir: Path,
    state: ShardState,
    client: PoliteClient,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
    stop: threading.Event | None = None,
    streams: int = 1,
    limiter: BandwidthLimiter | None = None,
) -> SourceReport:
    """Each chunk is resolved once (one API call, never concurrent), then fetched by
    `streams` workers sharing the client and the bandwidth limiter."""
    if streams < 1:
        raise ValueError("streams must be at least 1")
    report = SourceReport()
    started = clock()
    denials = 0
    halt = threading.Event()

    def fetch(task: ImageTask, url: str | None) -> tuple[ImageTask, str, str | None, int | None]:
        if halt.is_set() or (stop is not None and stop.is_set()):
            return task, "skipped", None, None
        if url is None:
            return task, "failed", "commons_missing", None
        destination = images_dir / image_filename(task.key)
        return task, *fetch_one(
            client, task, url, destination, report, sleep=sleep, limiter=limiter
        )

    def outcomes(pending: list[ImageTask], urls: dict[str, str | None]):
        if streams == 1:
            for task in pending:
                yield fetch(task, urls.get(task.key))
            return
        with ThreadPoolExecutor(max_workers=streams) as pool:
            futures = [pool.submit(fetch, task, urls.get(task.key)) for task in pending]
            for future in as_completed(futures):
                yield future.result()

    for chunk_start in range(0, len(tasks), RESOLVE_BATCH):
        if stop is not None and stop.is_set():
            break
        chunk = tasks[chunk_start : chunk_start + RESOLVE_BATCH]
        pending = [
            task
            for task in chunk
            if not (images_dir / image_filename(task.key)).exists() and task.key not in state.failed
        ]
        report.skipped += len(chunk) - len(pending)
        urls = resolve_urls(source, client, pending) if pending else {}
        for task, outcome, reason, status in outcomes(pending, urls):
            if outcome == "skipped":
                continue
            report.attempted += 1
            if outcome == "done":
                report.done += 1
            else:
                report.failed += 1
                if status == 500:
                    reason = "http_500"
                if status in (403, 429) or reason in ("transient_exhausted", "cooldown_too_long"):
                    report.retryable += 1
                    log.warning("%s remains pending for resume: %s", task.key, reason)
                else:
                    state.record_failure(task, reason or "unknown", status)
                    log.warning("%s skipped: %s (%s)", task.key, reason, task.url)
            denials = denials + 1 if status in (403, 429) else 0
            report.seconds = clock() - started
            if denials >= CONSECUTIVE_DENIALS_LIMIT and not halt.is_set():
                halt.set()
                blocked = SourceBlocked(
                    f"{source}: {denials} consecutive HTTP {status} responses; "
                    f"halve its rate (--rate {source}=…) and report"
                )
        if halt.is_set():
            state.save_source(source, report, complete=False)
            raise blocked
        if stop is not None and stop.is_set():
            break
        log.info(
            "%s shard progress %d/%d done=%d failed=%d skipped=%d %.2f req/s",
            source,
            chunk_start + len(chunk),
            len(tasks),
            report.done,
            report.failed,
            report.skipped,
            report.rate,
        )
        state.save_source(source, report, complete=False)
    report.seconds = clock() - started
    stopped = stop is not None and stop.is_set()
    complete = not stopped and not report.retryable
    state.save_source(source, report, complete=complete)
    if report.retryable and not stopped:
        raise DownloadIncomplete(
            f"{source}: {report.retryable} retryable downloads; resume the run"
        )
    return report


def download_shard(
    shard: int,
    tasks: list[ImageTask],
    *,
    images_dir: Path,
    state_dir: Path,
    client_factory: ClientFactory,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
    streams: dict[str, int] | None = None,
    mbps: float = WIKIMEDIA_MBPS,
) -> dict[str, SourceReport]:
    """Sources run concurrently so the slow Commons queue never holds up the Met."""
    shard_dir = Path(images_dir) / f"shard-{shard}"
    shard_dir.mkdir(parents=True, exist_ok=True)
    state = ShardState(state_dir, shard)
    state.bind_inputs(tasks, shard_dir)
    by_source: dict[str, list[ImageTask]] = {}
    for task in tasks:
        by_source.setdefault(task.source, []).append(task)
    stop = threading.Event()
    streams = streams or dict(SOURCE_STREAMS)
    wikimedia = BandwidthLimiter(mbps, clock=clock, sleep=sleep)

    def run(source: str) -> SourceReport:
        with client_factory(source) as client:
            try:
                return download_source(
                    source,
                    by_source[source],
                    images_dir=shard_dir,
                    state=state,
                    client=client,
                    sleep=sleep,
                    clock=clock,
                    stop=stop,
                    streams=streams.get(source, 1),
                    limiter=wikimedia if source == "wikidata" else None,
                )
            except BaseException:
                stop.set()
                raise

    reports: dict[str, SourceReport] = {}
    with ThreadPoolExecutor(max_workers=max(1, len(by_source))) as pool:
        try:
            futures = {source: pool.submit(run, source) for source in sorted(by_source)}
            errors = []
            for source, future in futures.items():
                try:
                    reports[source] = future.result()
                except Exception as error:  # noqa: BLE001 - every source's outcome is reported
                    errors.append(error)
        except BaseException:
            stop.set()
            raise
    state.finish(by_source)
    if errors:
        raise errors[0]
    return reports


def parse_rates(value: str | None) -> dict[str, float]:
    rates = dict(SOURCE_RATES)
    for item in (value or "").split(","):
        if not item:
            continue
        source, _, rate = item.partition("=")
        if source not in rates or not rate:
            raise argparse.ArgumentTypeError(f"--rate expects source=req/s among {sorted(rates)}")
        rates[source] = float(rate)
    return rates


def parse_streams(value: str | None) -> dict[str, int]:
    streams = dict(SOURCE_STREAMS)
    for item in (value or "").split(","):
        if not item:
            continue
        source, _, count = item.partition("=")
        if source not in streams or not count.isdigit() or int(count) < 1:
            raise argparse.ArgumentTypeError(
                f"--streams expects source=count among {sorted(streams)}"
            )
        streams[source] = int(count)
    return streams


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Download one shard of corpus images to scratch")
    parser.add_argument("--metadata", type=Path, help="02.03 output directory (objects.jsonl)")
    parser.add_argument("--out", type=Path, help="images directory (default SCRATCH_DIR/images)")
    parser.add_argument(
        "--state", type=Path, help="progress directory (default SCRATCH_DIR/downloads)"
    )
    parser.add_argument("--shard", type=int, help="shard number; omit for every shard in order")
    parser.add_argument("--shard-size", type=int, default=SHARD_SIZE)
    parser.add_argument("--limit", type=int, help="only the first N downloadable objects")
    parser.add_argument(
        "--rate", type=parse_rates, default=dict(SOURCE_RATES), help="met=8,wikidata=10"
    )
    parser.add_argument(
        "--streams", type=parse_streams, default=dict(SOURCE_STREAMS), help="wikidata=2"
    )
    parser.add_argument(
        "--mbps", type=float, default=WIKIMEDIA_MBPS, help="Wikimedia media bandwidth cap"
    )
    args = parser.parse_args(argv)
    settings = get_settings()
    setup_logging(settings)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    metadata = args.metadata or settings.scratch_dir / "metadata"
    shards = plan_shards(
        iter_tasks(metadata / "objects.jsonl"), shard_size=args.shard_size, limit=args.limit
    )
    selected = range(len(shards)) if args.shard is None else [args.shard]
    factory = default_client_factory(settings, args.rate)
    for shard in selected:
        if shard >= len(shards):
            parser.error(f"shard {shard} does not exist; {len(shards)} shards planned")
        reports = download_shard(
            shard,
            shards[shard],
            images_dir=args.out or settings.scratch_dir / "images",
            state_dir=args.state or settings.scratch_dir / "downloads",
            client_factory=factory,
            streams=args.streams,
            mbps=args.mbps,
        )
        print(json.dumps({"shard": shard, **{s: r.as_dict() for s, r in reports.items()}}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
