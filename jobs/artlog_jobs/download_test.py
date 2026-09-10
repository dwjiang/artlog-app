import json
import random
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from io import BytesIO
from pathlib import Path

import httpx
import pytest
from PIL import Image

from artlog_jobs import download as download_module
from artlog_jobs.download import (
    COMMONS_THUMB_WIDTH,
    COMMONS_TITLES_PER_CALL,
    MAX_SIDE,
    BandwidthLimiter,
    ImageTask,
    ShardState,
    SourceBlocked,
    commons_batches,
    commons_title,
    download_shard,
    image_filename,
    iter_tasks,
    key_from_filename,
    plan_shards,
    resolve_commons,
    source_of,
)
from artlog_jobs.polite_http import PoliteClient

UA = "artlog-bot/0.1 (+https://example.org)"
MET = "https://images.metmuseum.org/CRDImages/ep/original/"
COMMONS = "https://commons.wikimedia.org/wiki/Special:FilePath/"
UPLOAD = "https://upload.wikimedia.org/wikipedia/commons/thumb/"


def media_path(task: ImageTask) -> str:
    """Where the fixture server serves a task's bytes: Met originals directly, Commons files
    at the thumbnail URL the imageinfo stub hands out."""
    if task.source == "wikidata":
        name = commons_title(task.url).removeprefix("File:").replace(" ", "_")
        return f"/wikipedia/commons/thumb/{name}/{COMMONS_THUMB_WIDTH}px-{name}"
    return httpx.URL(task.url).path


def jpeg(width: int, height: int, color=(200, 30, 30)) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (width, height), color).save(buffer, "JPEG")
    return buffer.getvalue()


class Server:
    """A MockTransport standing in for the image hosts and the Commons API; records requests."""

    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.images: dict[str, bytes] = {}
        self.retry_once: set[str] = set()
        self.deny: set[str] = set()
        self.missing: set[str] = set()
        self.widths: dict[str, int] = {}

    def imageinfo(self, request: httpx.Request) -> httpx.Response:
        titles = request.url.params["titles"].split("|")
        assert len(titles) <= COMMONS_TITLES_PER_CALL
        width = int(request.url.params["iiurlwidth"])
        pages, normalized = [], []
        for title in titles:
            name = title.removeprefix("File:").replace(" ", "_")
            canonical = f"File:{name.replace('_', ' ')}"
            if canonical != title:
                normalized.append({"from": title, "to": canonical})
            if name in self.missing:
                pages.append({"title": canonical, "missing": True})
            else:
                # Like the live API: a file no wider than the request comes back unscaled.
                file_width = self.widths.get(name, 2000)
                original = f"https://upload.wikimedia.org/wikipedia/commons/{name}"
                thumb = (
                    f"https://upload.wikimedia.org/wikipedia/commons/thumb/{name}/{width}px-{name}"
                )
                info = {
                    "url": original,
                    "width": file_width,
                    "thumburl": thumb if width < file_width else original,
                }
                pages.append({"title": canonical, "imageinfo": [info]})
        return httpx.Response(200, json={"query": {"normalized": normalized, "pages": pages}})

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if request.url.host == "commons.wikimedia.org" and path == "/w/api.php":
            return self.imageinfo(request)
        if path in self.deny:
            return httpx.Response(403)
        if path in self.retry_once:
            self.retry_once.discard(path)
            return httpx.Response(429, headers={"Retry-After": "1"})
        if path in self.images:
            return httpx.Response(200, content=self.images[path])
        return httpx.Response(404)


class Sleeper:
    def __init__(self):
        self.calls: list[float] = []
        self.now = 0.0

    def __call__(self, seconds: float) -> None:
        self.calls.append(seconds)
        self.now += seconds

    def clock(self) -> float:
        return self.now


def factory(server: Server, sleeper: Sleeper):
    def make(source: str) -> PoliteClient:
        return PoliteClient(
            user_agent=UA,
            per_host_rps=1000.0,
            robots=False,
            cache_max_bytes=0,
            transport=httpx.MockTransport(server),
            sleep=sleeper,
            clock=sleeper.clock,
        )

    return make


def tasks_for(server: Server, count: int) -> list[ImageTask]:
    tasks = []
    for index in range(count):
        if index % 2:
            key, url = f"met:{index}", f"{MET}DP{index}.jpg"
        else:
            key, url = f"wikidata:Q{index}", f"{COMMONS}Painting%20{index}.jpg"
        task = ImageTask(key, url, source_of(key))
        server.images[media_path(task)] = jpeg(40 + index, 30)
        tasks.append(task)
    return tasks


def run(server, tasks, tmp_path, *, shard=0):
    sleeper = Sleeper()
    reports = download_shard(
        shard,
        tasks,
        images_dir=tmp_path / "images",
        state_dir=tmp_path / "downloads",
        client_factory=factory(server, sleeper),
        sleep=sleeper,
        clock=sleeper.clock,
    )
    return reports, sleeper


def test_shards_are_deterministic_interleave_sources_and_honor_the_limit():
    tasks = tasks_for(Server(), 30)
    shuffled = list(tasks)
    random.Random(7).shuffle(shuffled)

    first = plan_shards(tasks, shard_size=10)
    second = plan_shards(shuffled, shard_size=10)

    assert first == second
    assert [len(shard) for shard in first] == [10, 10, 10]
    assert all({task.source for task in shard} == {"met", "wikidata"} for shard in first)
    assert plan_shards(tasks, shard_size=10, limit=7) == [first[0][:7]]


def test_only_objects_with_an_image_reference_are_planned(tmp_path):
    rows = [
        {"key": "met:1", "imageRef": f"{MET}a.jpg"},
        {"key": "aic:2", "pageUrl": "https://www.artic.edu/artworks/2"},
        {"key": "wikidata:Q3", "imageRef": f"{COMMONS}x.jpg"},
    ]
    path = tmp_path / "objects.jsonl"
    path.write_text("".join(json.dumps(row) + "\n" for row in rows))

    assert [task.key for task in iter_tasks(path)] == ["met:1", "wikidata:Q3"]
    with pytest.raises(ValueError):
        source_of("crawl:example.org:1")


def test_filenames_round_trip_and_commons_titles_are_decoded():
    for key in ("met:436535", "wikidata:Q12418", "aic:27992"):
        assert key_from_filename(image_filename(key)) == key
    assert "/" not in image_filename("crawl:a/b")
    assert (
        commons_title(f"{COMMONS}A%20painting%20%28detail%29.jpg") == "File:A painting (detail).jpg"
    )
    with pytest.raises(ValueError):
        commons_title(f"{MET}x.jpg")


def test_commons_files_resolve_through_imageinfo_in_bounded_batches():
    server = Server()
    tasks = [
        ImageTask(f"wikidata:Q{i}", f"{COMMONS}%E5%BE%90%E6%B8%AD%20{i}.jpg", "wikidata")
        for i in range(120)
    ]
    server.missing.add("徐渭_7.jpg")
    client = PoliteClient(
        user_agent=UA, per_host_rps=1000, robots=False, transport=httpx.MockTransport(server)
    )

    batches = list(commons_batches(tasks))
    resolved = resolve_commons(client, tasks)

    assert all(len(batch) <= COMMONS_TITLES_PER_CALL for batch in batches)
    assert sum(len(batch) for batch in batches) == 120 and len(batches) == len(server.requests)
    assert resolved["wikidata:Q7"] is None
    assert resolved["wikidata:Q8"] == f"{UPLOAD}徐渭_8.jpg/{COMMONS_THUMB_WIDTH}px-徐渭_8.jpg"
    assert all(
        str(r.url).startswith("https://commons.wikimedia.org/w/api.php?") for r in server.requests
    )


def test_narrow_files_are_fetched_as_the_standard_thumbnail_below_their_width(tmp_path):
    from artlog_jobs.download import thumbnail_step

    assert [thumbnail_step(w) for w in (961, 960, 501, 500, 21, 20, None)] == [
        960,
        500,
        500,
        330,
        20,
        960,
        960,
    ]

    server = Server()
    expected = {"Wide.jpg": 960, "Narrow.jpg": 500, "Tiny.jpg": 330}
    server.widths.update({"Narrow.jpg": 800, "Tiny.jpg": 400})
    tasks = [
        ImageTask(f"wikidata:Q{i}", f"{COMMONS}{n}", "wikidata") for i, n in enumerate(expected)
    ]
    for name, width in expected.items():
        server.images[f"/wikipedia/commons/thumb/{name}/{width}px-{name}"] = jpeg(40, 30)

    reports, _ = run(server, tasks, tmp_path)

    assert reports["wikidata"].done == 3
    api = [r.url.params["iiurlwidth"] for r in server.requests if r.url.path == "/w/api.php"]
    assert api == ["960", "500", "330"]
    media = sorted(r.url.path for r in server.requests if r.url.host == "upload.wikimedia.org")
    assert media == sorted(f"/wikipedia/commons/thumb/{n}/{w}px-{n}" for n, w in expected.items())
    assert not any("/thumb/" not in path for path in media)


def test_a_missing_commons_file_is_a_recorded_failure_without_a_media_request(tmp_path):
    server = Server()
    tasks = tasks_for(server, 2)
    server.missing.add("Painting_0.jpg")

    reports, _ = run(server, tasks, tmp_path)

    assert reports["wikidata"].failed == 1 and reports["wikidata"].done == 0
    failed = json.loads((tmp_path / "downloads" / "shard-0-failed.jsonl").read_text())
    assert failed["reason"] == "commons_missing" and failed["status"] is None
    assert [r.url.host for r in server.requests].count("upload.wikimedia.org") == 0


def test_images_are_resized_below_the_cap_and_never_kept_as_originals(tmp_path):
    server = Server()
    tasks = tasks_for(server, 2)
    server.images[media_path(tasks[0])] = jpeg(3000, 1500)

    reports, _ = run(server, tasks, tmp_path)

    saved = Image.open(tmp_path / "images" / "shard-0" / image_filename(tasks[0].key))
    assert saved.format == "JPEG" and max(saved.size) == MAX_SIDE and saved.size == (1024, 512)
    assert reports["wikidata"].done == 1 and reports["met"].done == 1
    assert any(r.url.host == "upload.wikimedia.org" for r in server.requests)
    assert not list((tmp_path / "images" / "shard-0").glob("*.tmp"))
    state = json.loads((tmp_path / "downloads" / "shard-0.json").read_text())
    assert state["complete"] and state["sources"]["met"]["done"] == 1


def test_a_resumed_shard_skips_downloaded_files_and_recorded_failures(tmp_path):
    server = Server()
    tasks = tasks_for(server, 6)
    del server.images[media_path(tasks[2])]
    run(server, tasks, tmp_path)
    failed = [
        json.loads(line)
        for line in (tmp_path / "downloads" / "shard-0-failed.jsonl").read_text().splitlines()
    ]
    assert failed == [
        {
            "key": tasks[2].key,
            "url": tasks[2].url,
            "source": "wikidata",
            "reason": "http_404",
            "status": 404,
        }
    ]
    # A crash after five files: the sixth file is missing again, the rest survive.
    lost = tmp_path / "images" / "shard-0" / image_filename(tasks[5].key)
    lost.unlink()
    server.requests.clear()

    reports, _ = run(server, tasks, tmp_path)

    assert [r.url.path for r in server.requests] == [media_path(tasks[5])]
    assert reports["met"].done == 1 and reports["met"].skipped == 2
    assert reports["wikidata"].done == 0 and reports["wikidata"].skipped == 3
    assert lost.exists()


def test_a_429_is_retried_after_the_server_cooldown(tmp_path):
    server = Server()
    tasks = tasks_for(server, 1)
    server.retry_once.add(media_path(tasks[0]))

    reports, sleeper = run(server, tasks, tmp_path)

    assert reports["wikidata"].done == 1 and reports["wikidata"].failed == 0
    # The polite client absorbs the 429 and its Retry-After before returning the 200.
    assert reports["wikidata"].statuses == {"200": 1} and reports["wikidata"].retries == 0
    assert max(sleeper.calls) == pytest.approx(1.0, abs=0.05)


def test_consecutive_denials_stop_the_source_with_a_reportable_error(tmp_path):
    server = Server()
    tasks = [task for task in tasks_for(server, 60) if task.source == "met"]
    server.deny.update(media_path(task) for task in tasks)

    with pytest.raises(SourceBlocked, match="met: 20 consecutive HTTP 403"):
        run(server, tasks, tmp_path)

    state = ShardState(tmp_path / "downloads", 0)
    assert not state.complete and not state.failed
    assert state.data["sources"]["met"]["complete"] is False


def test_source_blocked_images_are_downloaded_after_recovery(tmp_path):
    server = Server()
    tasks = [task for task in tasks_for(server, 50) if task.source == "met"]
    server.deny.update(media_path(task) for task in tasks)
    with pytest.raises(SourceBlocked):
        run(server, tasks, tmp_path)
    server.deny.clear()

    reports, _ = run(server, tasks, tmp_path)

    assert reports["met"].done == len(tasks)
    assert len(list((tmp_path / "images" / "shard-0").glob("*.jpg"))) == len(tasks)
    assert ShardState(tmp_path / "downloads", 0).complete


@pytest.mark.parametrize("status", [403, 429, 503, None])
def test_temporary_failures_leave_the_shard_incomplete_and_retry_on_resume(tmp_path, status):
    recovered = False
    task = ImageTask("met:1", f"{MET}DP1.jpg", "met")

    def handler(request):
        if recovered:
            return httpx.Response(200, content=jpeg(40, 30))
        if status is None:
            raise httpx.ConnectError("offline", request=request)
        return httpx.Response(status)

    with pytest.raises(RuntimeError, match="retryable"):
        run(handler, [task], tmp_path)
    state = ShardState(tmp_path / "downloads", 0)
    assert not state.complete and not state.failed
    recovered = True

    reports, _ = run(handler, [task], tmp_path)

    assert reports["met"].done == 1
    assert ShardState(tmp_path / "downloads", 0).complete


def test_repeated_long_429_cooldowns_stop_the_source(tmp_path):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(429, headers={"Retry-After": "180"})

    tasks = [ImageTask(f"met:{i}", f"{MET}DP{i}.jpg", "met") for i in range(25)]
    with pytest.raises(SourceBlocked, match="20 consecutive HTTP 429"):
        run(handler, tasks, tmp_path)

    assert len(requests) == 60
    state = ShardState(tmp_path / "downloads", 0)
    assert not state.complete and not state.failed
    assert state.data["sources"]["met"]["statuses"] == {"429": 60}


def test_caller_interruption_stops_workers_after_the_current_image(tmp_path, monkeypatch):
    started = threading.Event()
    shutting_down = threading.Event()
    requests = []

    def handler(request):
        requests.append(request)
        started.set()
        assert shutting_down.wait(5)
        return httpx.Response(200, content=jpeg(40, 30))

    class ObservedExecutor(ThreadPoolExecutor):
        def __exit__(self, *args):
            shutting_down.set()
            return super().__exit__(*args)

    def interrupt(future):
        assert started.wait(5)
        raise KeyboardInterrupt

    monkeypatch.setattr(download_module, "ThreadPoolExecutor", ObservedExecutor)
    monkeypatch.setattr(Future, "result", interrupt)
    tasks = [ImageTask(f"met:{i}", f"{MET}DP{i}.jpg", "met") for i in range(20)]

    with pytest.raises(KeyboardInterrupt):
        run(handler, tasks, tmp_path)

    assert len(requests) == 1
    assert not ShardState(tmp_path / "downloads", 0).complete


def test_shard_directories_hold_only_their_own_images(tmp_path: Path):
    server = Server()
    tasks = tasks_for(server, 4)
    run(server, tasks[:2], tmp_path, shard=0)
    run(server, tasks[2:], tmp_path, shard=1)

    assert sorted(p.name for p in (tmp_path / "images" / "shard-0").iterdir()) == sorted(
        image_filename(t.key) for t in tasks[:2]
    )
    assert len(list((tmp_path / "images" / "shard-1").iterdir())) == 2


def test_bandwidth_limiter_keeps_any_trailing_window_under_the_cap():
    sleeper = Sleeper()
    limiter = BandwidthLimiter(25.0, clock=sleeper.clock, sleep=sleeper)  # 31.25 MB per 10 s

    limiter.wait()
    limiter.account(20_000_000)
    sleeper(2.0)
    limiter.wait()
    limiter.account(12_000_000)
    limiter.wait()

    assert sleeper.now == pytest.approx(10.0)  # the first 20 MB left the window
    limiter.wait()
    assert sleeper.now == pytest.approx(10.0)
    with pytest.raises(ValueError):
        BandwidthLimiter(0)


def test_commons_media_uses_two_streams_and_never_overlaps_api_calls(tmp_path):
    server = Server()
    tasks = [task for task in tasks_for(server, 40) if task.source == "wikidata"]
    lock = threading.Lock()
    in_flight = {"api": 0, "media": 0}
    peak = {"api": 0, "media": 0}

    def handler(request):
        kind = "api" if request.url.host == "commons.wikimedia.org" else "media"
        with lock:
            in_flight[kind] += 1
            peak[kind] = max(peak[kind], in_flight[kind])
        time.sleep(0.02)
        try:
            return server(request)
        finally:
            with lock:
                in_flight[kind] -= 1

    reports, _ = run(handler, tasks, tmp_path)

    assert reports["wikidata"].done == 20 and reports["wikidata"].failed == 0
    assert peak["media"] == 2 and peak["api"] == 1
    assert len(list((tmp_path / "images" / "shard-0").glob("*.jpg"))) == 20


def test_a_denial_streak_stops_both_streams(tmp_path):
    server = Server()
    tasks = [task for task in tasks_for(server, 80) if task.source == "wikidata"]
    server.deny.update(media_path(task) for task in tasks)

    with pytest.raises(SourceBlocked, match="wikidata: 20 consecutive HTTP 403"):
        run(server, tasks, tmp_path)

    media = [r for r in server.requests if r.url.host == "upload.wikimedia.org"]
    assert 20 <= len(media) <= 50
