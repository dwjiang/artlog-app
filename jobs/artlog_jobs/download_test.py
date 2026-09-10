import json
import random
from io import BytesIO
from pathlib import Path

import httpx
import pytest
from PIL import Image

from artlog_jobs.download import (
    COMMONS_THUMB_WIDTH,
    COMMONS_TITLES_PER_CALL,
    MAX_SIDE,
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

    def imageinfo(self, request: httpx.Request) -> httpx.Response:
        titles = request.url.params["titles"].split("|")
        assert len(titles) <= COMMONS_TITLES_PER_CALL
        assert request.url.params["iiurlwidth"] == str(COMMONS_THUMB_WIDTH)
        pages, normalized = [], []
        for title in titles:
            name = title.removeprefix("File:").replace(" ", "_")
            canonical = f"File:{name.replace('_', ' ')}"
            if canonical != title:
                normalized.append({"from": title, "to": canonical})
            if name in self.missing:
                pages.append({"title": canonical, "missing": True})
            else:
                thumb = f"https://upload.wikimedia.org/wikipedia/commons/thumb/{name}/{COMMONS_THUMB_WIDTH}px-{name}"
                pages.append(
                    {"title": canonical, "imageinfo": [{"url": "orig", "thumburl": thumb}]}
                )
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

    def __call__(self, seconds: float) -> None:
        self.calls.append(seconds)


def factory(server: Server, sleeper: Sleeper):
    def make(source: str) -> PoliteClient:
        return PoliteClient(
            user_agent=UA,
            per_host_rps=1000.0,
            robots=False,
            cache_max_bytes=0,
            transport=httpx.MockTransport(server),
            sleep=sleeper,
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
    assert not state.complete and len(state.failed) == 20
    assert state.data["sources"]["met"]["complete"] is False


def test_shard_directories_hold_only_their_own_images(tmp_path: Path):
    server = Server()
    tasks = tasks_for(server, 4)
    run(server, tasks[:2], tmp_path, shard=0)
    run(server, tasks[2:], tmp_path, shard=1)

    assert sorted(p.name for p in (tmp_path / "images" / "shard-0").iterdir()) == sorted(
        image_filename(t.key) for t in tasks[:2]
    )
    assert len(list((tmp_path / "images" / "shard-1").iterdir())) == 2
