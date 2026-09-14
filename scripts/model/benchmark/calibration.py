import argparse
import json
import time
from email.utils import parsedate_to_datetime
from hashlib import sha256
from io import BytesIO
from pathlib import Path

import requests
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent
ARTIFACTS = ROOT / "artifacts"
REPO_ROOT = ROOT.parents[2]
URLS = REPO_ROOT / "shared/model/calibration/urls.txt"
HASHES = REPO_ROOT / "jobs/calibration/image-hashes.json"


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
                error = (
                    PermissionError(f"Access refused (403): {url}")
                    if status == 403
                    else requests.HTTPError(f"HTTP {status}: {url}", response=response)
                )
                header = response.headers.get("Retry-After", "")
                if header:
                    try:
                        retry_after = float(header)
                    except ValueError:
                        try:
                            retry_after = (
                                parsedate_to_datetime(header).timestamp() - time.time()
                            )
                        except (ValueError, TypeError, OverflowError):
                            pass
            except (requests.ConnectionError, requests.Timeout) as failure:
                error = failure
            finally:
                if response is not None:
                    response.close()
            if attempt == 3:
                raise error
            delay = max(15 * 2**attempt, retry_after)
            if delay > 300:
                raise RuntimeError(
                    f"Server requests a {delay:.0f}s cooldown; resume later: {url}"
                ) from error
            print(f"{error}; retry {attempt + 2}/4 in {delay:.0f}s", flush=True)
            self.next_request_at = max(self.next_request_at, time.monotonic() + delay)


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


def prepare(size):
    downloader = Downloader()
    urls = URLS.read_text().splitlines()
    hashes = json.loads(HASHES.read_text())
    if not urls or len(urls) != len(set(urls)) or not set(urls).issubset(hashes):
        raise ValueError(
            "Calibration URLs must be unique, nonempty, and have image hashes"
        )
    for url in urls:
        path = cache_image(url, downloader)
        if sha256(path.read_bytes()).hexdigest() != hashes[url]:
            raise ValueError(f"Image hash mismatch: {url}")
    destination = ARTIFACTS / f"calibration-{size}"
    destination.mkdir(parents=True, exist_ok=True)
    manifest = []
    for i, url in enumerate(urls):
        with Image.open(image_path(url)) as original:
            image = letterbox(original, size)
        name = f"{i:03}.rgb"
        (destination / name).write_bytes(image.tobytes())
        manifest.append(
            {
                "url": url,
                "file": name,
                "pixel_sha256": sha256(image.tobytes()).hexdigest(),
            }
        )
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--size", type=int, choices=(448, 512), default=512)
    args = parser.parse_args()
    prepare(args.size)
