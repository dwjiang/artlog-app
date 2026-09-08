import argparse
from email.utils import parsedate_to_datetime
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import time
from urllib.parse import urlencode

import requests
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent
ARTIFACTS = ROOT / "artifacts"
CALIBRATION = ROOT / "calibration"
API = "https://collectionapi.metmuseum.org/public/collection"
CALIBRATION_COUNT = 200
INDEX_COUNT = 2000


class Downloader:
    def __init__(self):
        self.session = requests.Session()
        self.next_request_at = 0.0

    def get(self, url):
        for attempt in range(4):
            time.sleep(max(0, self.next_request_at - time.monotonic()))
            self.next_request_at = time.monotonic() + 1
            response = None
            retry_after = 0
            try:
                response = self.session.get(url, timeout=45)
                status = response.status_code
                if status == 401:
                    raise PermissionError(f"Authentication required: {url}")
                if status not in (403, 429) and status < 500:
                    response.raise_for_status()
                    return response.content
                error = (PermissionError(f"Access refused (403): {url}") if status == 403
                         else requests.HTTPError(f"HTTP {status}: {url}", response=response))
                header = response.headers.get("Retry-After", "")
                if header:
                    try:
                        retry_after = float(header)
                    except ValueError:
                        try:
                            retry_after = parsedate_to_datetime(header).timestamp() - time.time()
                        except (ValueError, TypeError, OverflowError):
                            pass
            except (requests.ConnectionError, requests.Timeout) as failure:
                error = failure
            finally:
                if response is not None:
                    response.close()
            if attempt == 3:
                raise error
            delay = max(15 * 2 ** attempt, retry_after)
            if delay > 300:
                raise RuntimeError(f"Server requests a {delay:.0f}s cooldown; resume later: {url}") from error
            print(f"{error}; retry {attempt + 2}/4 in {delay:.0f}s", flush=True)
            self.next_request_at = max(self.next_request_at, time.monotonic() + delay)


def save_json(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def letterbox(image, size):
    image = ImageOps.exif_transpose(image).convert("RGB")
    scale = size / max(image.size)
    dimensions = tuple(max(1, round(d * scale)) for d in image.size)
    resized = image.resize(dimensions, Image.Resampling.BICUBIC)
    square = Image.new("RGB", (size, size), (0, 0, 0))
    square.paste(resized, ((size - dimensions[0]) // 2, (size - dimensions[1]) // 2))
    return square


def image_path(url):
    return ARTIFACTS / "images" / (sha256(url.encode()).hexdigest() + ".jpg")


def cache_image(url, downloader):
    path = image_path(url)
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        data = downloader.get(url)
        Image.open(BytesIO(data)).verify()
        temporary = path.with_suffix(".tmp")
        temporary.write_bytes(data)
        temporary.replace(path)
    return path


def fetch_record(object_id, downloader):
    cache = ARTIFACTS / "met" / f"{object_id}.json"
    try:
        if not cache.exists():
            save_json(cache, json.loads(downloader.get(f"{API}/v1/objects/{object_id}")))
        record = json.loads(cache.read_text())
        if not record.get("isPublicDomain") or not record.get("primaryImageSmall"):
            return None
        if "painting" not in record.get("classification", "").lower():
            return None
        url = record["primaryImageSmall"]
        path = cache_image(url, downloader)
        return {"objectID": object_id, "url": url, "isPublicDomain": True,
                "classification": record["classification"], "sha256": sha256(path.read_bytes()).hexdigest()}
    except PermissionError:
        raise
    except requests.HTTPError as error:
        if error.response is None or error.response.status_code not in (404, 410):
            raise
        print(f"Skipped {object_id}: {error}", flush=True)
        return None


def search_ids(downloader):
    ids = set()
    offset = 0
    pages = ARTIFACTS / "search"
    pages.mkdir(exist_ok=True)
    while True:
        cache = pages / f"{offset}.json"
        if not cache.exists():
            query = urlencode(dict(hasImages="true", medium="Paintings", q="painting", limit=500, offset=offset))
            save_json(cache, json.loads(downloader.get(f"{API}/v1.1/search?{query}")))
        page = json.loads(cache.read_text())
        ids.update(page.get("objectIDs") or [])
        offset += 500
        if offset >= page["total"]:
            break
    return sorted(ids, key=lambda i: sha256(f"artlog-00.01:{i}".encode()).hexdigest())


def collect():
    for directory in (CALIBRATION, ARTIFACTS / "met", ARTIFACTS / "images"):
        directory.mkdir(parents=True, exist_ok=True)
    downloader = Downloader()
    state_path = ARTIFACTS / "collection-state.json"
    if state_path.exists():
        state = json.loads(state_path.read_text())
    else:
        state = {"object_ids": search_ids(downloader), "next_index": 0, "selected": []}
        save_json(state_path, state)
    selected = state["selected"]
    seen = {value for record in selected for value in (record["sha256"], record["url"])}
    required = CALIBRATION_COUNT + INDEX_COUNT
    print(f"Resuming at object {state['next_index']}; {len(selected)}/{required} paintings", flush=True)
    while state["next_index"] < len(state["object_ids"]) and len(selected) < required:
        record = fetch_record(state["object_ids"][state["next_index"]], downloader)
        if record and record["sha256"] not in seen and record["url"] not in seen:
            selected.append(record)
            seen.update((record["sha256"], record["url"]))
            print(f"Collected {len(selected)}/{required}", flush=True)
        state["next_index"] += 1
        save_json(state_path, state)
    if len(selected) < required:
        raise RuntimeError(f"Only {len(selected)} valid unique CC0 paintings; need {required}")
    for name, records in (("urls.txt", selected[:CALIBRATION_COUNT]), ("index-urls.txt", selected[CALIBRATION_COUNT:])):
        (CALIBRATION / name).write_text("".join(r["url"] + "\n" for r in records))
    save_json(CALIBRATION / "manifest.json", selected)


def prepare(size):
    downloader = Downloader()
    urls = (CALIBRATION / "urls.txt").read_text().splitlines()
    index_file = CALIBRATION / "index-urls.txt"
    index_urls = index_file.read_text().splitlines() if index_file.exists() else []
    hashes = {record["url"]: record["sha256"]
              for record in json.loads((CALIBRATION / "manifest.json").read_text())}
    for url in urls + index_urls:
        path = cache_image(url, downloader)
        if sha256(path.read_bytes()).hexdigest() != hashes[url]:
            raise ValueError(f"Image hash mismatch: {url}")
    destination = ARTIFACTS / f"calibration-{size}"
    destination.mkdir(parents=True, exist_ok=True)
    manifest = []
    for i, url in enumerate(urls):
        image = letterbox(Image.open(image_path(url)), size)
        name = f"{i:03}.rgb"
        (destination / name).write_bytes(image.tobytes())
        manifest.append({"url": url, "file": name, "pixel_sha256": sha256(image.tobytes()).hexdigest()})
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("collect", "prepare"))
    parser.add_argument("--size", type=int, choices=(448, 512), default=512)
    args = parser.parse_args()
    collect() if args.command == "collect" else prepare(args.size)
