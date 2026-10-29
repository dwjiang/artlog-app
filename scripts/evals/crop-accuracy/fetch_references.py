"""Downloads the Commons reference image of every photo in the photo set, the image the corpus indexed.

uv run python fetch_references.py --photos <photo set dir> --out <eval dir>
"""

import argparse
import json
import time
from pathlib import Path

import httpx

API = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "artlog-crop-eval/0.1 (+https://github.com/dwjiang/artlog-app)"
WIDTH = 1280
TITLES_PER_REQUEST = 50


def get(client: httpx.Client, url: str, **params) -> httpx.Response:
    for attempt in range(6):
        response = client.get(url, params=params or None)
        if response.status_code == 429 or response.status_code >= 500:
            time.sleep(float(response.headers.get("retry-after", 5 * (attempt + 1))))
            continue
        response.raise_for_status()
        return response
    raise RuntimeError(f"gave up on {url}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--photos", type=Path, required=True, help="directory with photos.jsonl")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    rows = [json.loads(line) for line in (args.photos / "photos.jsonl").open() if line.strip()]
    names = sorted({name for row in rows for name in row["referenceFiles"]})
    folder = args.out / "references"
    folder.mkdir(parents=True, exist_ok=True)
    manifest_path = args.out / "references.jsonl"
    done = {json.loads(line)["name"] for line in manifest_path.open()} if manifest_path.exists() else set()
    todo = [name for name in names if name not in done]
    print(f"{len(todo)} of {len(names)} references to fetch", flush=True)

    client = httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=60, follow_redirects=True)
    with manifest_path.open("a") as manifest:
        for start in range(0, len(todo), TITLES_PER_REQUEST):
            batch = todo[start : start + TITLES_PER_REQUEST]
            query = get(
                client, API, action="query", format="json", prop="imageinfo", iiprop="url|size|mime",
                iiurlwidth=str(WIDTH), titles="|".join(f"File:{name}" for name in batch),
            ).json()["query"]
            # Titles come back normalized (underscores, first letter); map them back to the requested names.
            normalized = {entry["to"]: entry["from"] for entry in query.get("normalized", [])}
            for page in query["pages"].values():
                info = (page.get("imageinfo") or [None])[0]
                title = page["title"]
                name = normalized.get(title, title).removeprefix("File:")
                if not info or not info["mime"].startswith("image/"):
                    print(f"skip {name}: no image info", flush=True)
                    continue
                path = folder / f"{len(done):04d}{Path(info['thumburl']).suffix.lower() or '.jpg'}"
                path.write_bytes(get(client, info["thumburl"]).content)
                done.add(name)
                manifest.write(json.dumps({
                    "name": name, "path": path.name, "width": info["width"], "height": info["height"],
                }) + "\n")
                manifest.flush()
            print(f"fetched {min(start + TITLES_PER_REQUEST, len(todo))}/{len(todo)}", flush=True)


if __name__ == "__main__":
    main()
