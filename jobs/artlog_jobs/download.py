"""Download corpus images into scratch one shard at a time, each source at its polite
rate, resized so no original is ever kept (design §5.5, §5.7 step 3)."""

import argparse
import hashlib
import json
import logging
import sys
import threading
import time
from collections.abc import Callable, Iterable, Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from urllib.parse import quote, unquote, urlencode

import httpx
from PIL import Image, ImageOps, UnidentifiedImageError

from .config import Settings, get_settings, setup_logging
from .polite_http import PoliteClient, RetryLater

log = logging.getLogger(__name__)

SHARD_SIZE = 10_000
MAX_SIDE = 1024
JPEG_QUALITY = 90
COMMONS_THUMB_WIDTH = 1280
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
# Met CDN documented ceiling is 20 req/s; Wikimedia media: one request at a time, ≥ 1 s apart
# per host (decision 005); AIC: a single stream at ≤ 1 req/s with its identifying header.
SOURCE_RATES = {"met": 8.0, "aic": 1.0, "wikidata": 1.0}


class SourceBlocked(RuntimeError):
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

    @property
    def rate(self) -> float:
        return (self.done + self.failed) / self.seconds if self.seconds else 0.0

    def as_dict(self) -> dict:
        return {**self.__dict__, "rate": round(self.rate, 3)}


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


def resolve_commons(client: PoliteClient, tasks: list[ImageTask]) -> dict[str, str | None]:
    """Map object keys to `upload.wikimedia.org` thumbnail URLs through `imageinfo`
    (decision 005): one API call per batch instead of two redirect hops per file, and a
    server-rendered standard width for TIFF/PDF/SVG originals. Missing files map to None."""
    resolved: dict[str, str | None] = {}
    for batch in commons_batches(tasks):
        titles = sorted({commons_title(task.url) for task in batch})
        query = urlencode(
            {
                "action": "query",
                "prop": "imageinfo",
                "iiprop": "url",
                "iiurlwidth": COMMONS_THUMB_WIDTH,
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
        pages = {page["title"]: page for page in data.get("pages", [])}
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
    """`downloads/shard-<n>.json` (per-source progress) and `shard-<n>-failed.jsonl` outlive
    the image directory, so a resumed or already embedded shard is never fetched twice."""

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
        # Designated media endpoints of admitted sources (decision 005), not site crawling;
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
) -> tuple[str, str | None, int | None]:
    """Returns ('done' | 'failed', reason, http status)."""
    headers = {"AIC-User-Agent": client.user_agent} if task.source == "aic" else None
    last_status: int | None = None
    for attempt in range(ATTEMPTS):
        if attempt:
            report.retries += 1
            sleep(BACKOFF_SECONDS * 2 ** (attempt - 1))
        try:
            response = client.get(url, headers=headers)
        except RetryLater as cooldown:
            if cooldown.retry_after > MAX_COOLDOWN_SECONDS:
                return "failed", "cooldown_too_long", 429
            log.warning("%s cooling down %.0fs for %s", task.source, cooldown.retry_after, task.key)
            sleep(cooldown.retry_after)
            continue
        except httpx.TransportError as error:
            last_status = None
            log.warning("%s transport error for %s: %s", task.source, task.key, error)
            continue
        last_status = response.status_code
        report.statuses[str(last_status)] = report.statuses.get(str(last_status), 0) + 1
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
) -> SourceReport:
    report = SourceReport()
    started = clock()
    denials = 0
    index = 0
    for chunk_start in range(0, len(tasks), RESOLVE_BATCH):
        chunk = tasks[chunk_start : chunk_start + RESOLVE_BATCH]
        pending = [
            task
            for task in chunk
            if not (images_dir / image_filename(task.key)).exists() and task.key not in state.failed
        ]
        report.skipped += len(chunk) - len(pending)
        urls = resolve_urls(source, client, pending) if pending else {}
        for task in pending:
            if stop is not None and stop.is_set():
                break
            index = chunk_start + chunk.index(task) + 1
            report.attempted += 1
            url = urls.get(task.key)
            if url is None:
                outcome, reason, status = "failed", "commons_missing", None
            else:
                destination = images_dir / image_filename(task.key)
                outcome, reason, status = fetch_one(
                    client, task, url, destination, report, sleep=sleep
                )
            if outcome == "done":
                report.done += 1
            else:
                report.failed += 1
                state.record_failure(task, reason or "unknown", status)
            denials = denials + 1 if status in (403, 429) else 0
            report.seconds = clock() - started
            if denials >= CONSECUTIVE_DENIALS_LIMIT:
                state.save_source(source, report, complete=False)
                raise SourceBlocked(
                    f"{source}: {denials} consecutive HTTP {status} responses; "
                    f"halve its rate (--rate {source}=…) and report"
                )
        if stop is not None and stop.is_set():
            break
        index = chunk_start + len(chunk)
        log.info(
            "%s shard progress %d/%d done=%d failed=%d skipped=%d %.2f req/s",
            source,
            index,
            len(tasks),
            report.done,
            report.failed,
            report.skipped,
            report.rate,
        )
        state.save_source(source, report, complete=False)
    report.seconds = clock() - started
    complete = stop is None or not stop.is_set()
    state.save_source(source, report, complete=complete)
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
) -> dict[str, SourceReport]:
    """Sources run concurrently so the slow Commons queue never holds up the Met."""
    shard_dir = Path(images_dir) / f"shard-{shard}"
    shard_dir.mkdir(parents=True, exist_ok=True)
    state = ShardState(state_dir, shard)
    by_source: dict[str, list[ImageTask]] = {}
    for task in tasks:
        by_source.setdefault(task.source, []).append(task)
    stop = threading.Event()

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
                )
            except BaseException:
                stop.set()
                raise

    reports: dict[str, SourceReport] = {}
    with ThreadPoolExecutor(max_workers=max(1, len(by_source))) as pool:
        futures = {source: pool.submit(run, source) for source in sorted(by_source)}
        errors = []
        for source, future in futures.items():
            try:
                reports[source] = future.result()
            except Exception as error:  # noqa: BLE001 - every source's outcome is reported
                errors.append(error)
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
        "--rate", type=parse_rates, default=dict(SOURCE_RATES), help="met=8,wikidata=1"
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
        )
        print(json.dumps({"shard": shard, **{s: r.as_dict() for s, r in reports.items()}}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
