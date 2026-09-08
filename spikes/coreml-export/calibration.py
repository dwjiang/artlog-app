import argparse
from concurrent.futures import ThreadPoolExecutor
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


def download(url):
    for attempt in range(4):
        response = requests.get(url, timeout=45)
        if response.status_code in (401, 403):
            raise PermissionError(f"Access refused ({response.status_code}): {url}")
        if response.status_code != 429 and response.status_code < 500:
            response.raise_for_status()
            return response.content
        time.sleep(2 ** attempt)
    response.raise_for_status()


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


def fetch_record(object_id):
    cache = ARTIFACTS / "met" / f"{object_id}.json"
    try:
        if not cache.exists():
            cache.write_bytes(download(f"{API}/v1/objects/{object_id}"))
        record = json.loads(cache.read_text())
        if not record.get("isPublicDomain") or not record.get("primaryImageSmall"):
            return None
        if "painting" not in record.get("classification", "").lower():
            return None
        url = record["primaryImageSmall"]
        path = image_path(url)
        if not path.exists():
            data = download(url)
            Image.open(BytesIO(data)).verify()
            path.write_bytes(data)
        return {"objectID": object_id, "url": url, "isPublicDomain": True,
                "classification": record["classification"], "sha256": sha256(path.read_bytes()).hexdigest()}
    except PermissionError:
        raise
    except (requests.RequestException, OSError, ValueError) as error:
        print(f"Skipped {object_id}: {error}", flush=True)
        return None


def collect():
    for directory in (CALIBRATION, ARTIFACTS / "met", ARTIFACTS / "images"):
        directory.mkdir(parents=True, exist_ok=True)
    ids = set()
    offset = 0
    while True:
        query = urlencode(dict(hasImages="true", medium="Paintings", q="painting", limit=500, offset=offset))
        page = json.loads(download(f"{API}/v1.1/search?{query}"))
        ids.update(page.get("objectIDs") or [])
        offset += 500
        if offset >= page["total"]:
            break
    ordered = sorted(ids, key=lambda i: sha256(f"artlog-00.01:{i}".encode()).hexdigest())
    selected = []
    seen = set()
    with ThreadPoolExecutor(max_workers=4) as pool:
        for start in range(0, len(ordered), 40):
            for record in pool.map(fetch_record, ordered[start:start + 40]):
                if record and record["sha256"] not in seen and record["url"] not in seen:
                    selected.append(record)
                    seen.update((record["sha256"], record["url"]))
            print(f"Collected {len(selected)}/2200", flush=True)
            (ARTIFACTS / "partial-manifest.json").write_text(json.dumps(selected, indent=2) + "\n")
            if len(selected) >= 2200:
                break
    if len(selected) < 2200:
        raise RuntimeError(f"Only {len(selected)} valid unique CC0 paintings; need 2200")
    selected = selected[:2200]
    for name, records in (("urls.txt", selected[:200]), ("index-urls.txt", selected[200:])):
        (CALIBRATION / name).write_text("".join(r["url"] + "\n" for r in records))
    (CALIBRATION / "manifest.json").write_text(json.dumps(selected, indent=2) + "\n")


def prepare(size):
    urls = (CALIBRATION / "urls.txt").read_text().splitlines()
    destination = ARTIFACTS / f"calibration-{size}"
    destination.mkdir(exist_ok=True)
    manifest = []
    for i, url in enumerate(urls):
        path = image_path(url)
        path.parent.mkdir(exist_ok=True)
        if not path.exists():
            path.write_bytes(download(url))
        image = letterbox(Image.open(path), size)
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
