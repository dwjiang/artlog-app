import argparse
import csv
import hashlib
import json
import logging
import re
import tarfile
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlencode

from ..config import get_settings, setup_logging
from ..polite_http import PoliteClient

log = logging.getLogger(__name__)
MET_COLUMNS = {
    "Object ID",
    "Is Public Domain",
    "Classification",
    "Object Name",
    "Title",
    "Artist Display Name",
    "Object Date",
    "Object Begin Date",
    "Object End Date",
    "Medium",
    "Dimensions",
    "Object Number",
    "Gallery Number",
    "Link Resource",
    "Object Wikidata URL",
    "Artist Wikidata URL",
    "Department",
}
AIC_ARCHIVE = "https://artic-api-data.s3.amazonaws.com/artic-api-data.tar.bz2"
AIC_FIELDS = (
    "id,title,artwork_type_title,image_id,is_public_domain,is_on_view,gallery_title,"
    "main_reference_number,artist_title,artist_id,date_display,date_start,date_end,"
    "medium_display,dimensions,copyright_notice"
)


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False) + "\n")
    temporary.replace(path)


def download(client: PoliteClient, url: str, path: Path, *, chunk_bytes: int = 8 * 1024**2) -> dict:
    """Persist byte ranges with If-Range so interrupted dumps cannot mix revisions."""
    if chunk_bytes <= 0:
        raise ValueError("chunk_bytes must be positive")
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(path.suffix + ".part")
    receipt = path.with_suffix(path.suffix + ".download.json")
    state = json.loads(receipt.read_text()) if receipt.exists() else {}
    if state.get("url") != url:
        partial.unlink(missing_ok=True)
        state = {"url": url}
    if path.exists() and state.get("complete") and path.stat().st_size == state.get("bytes"):
        return state
    while True:
        start = partial.stat().st_size if partial.exists() else 0
        if start and not state.get("validator"):
            partial.unlink()
            start = 0
        if start and start == state.get("bytes"):
            break
        headers = {
            "Range": f"bytes={start}-{start + chunk_bytes - 1}",
            "Accept-Encoding": "identity",
        }
        if start:
            headers["If-Range"] = state["validator"]
        response = client.get(url, headers=headers)
        response.raise_for_status()
        if response.status_code == 206:
            match = re.fullmatch(
                r"bytes (\d+)-(\d+)/(\d+)", response.headers.get("Content-Range", "")
            )
            if not match:
                raise ValueError("Invalid download range response")
            first, last, total = map(int, match.groups())
            validator = response.headers.get("ETag") or response.headers.get("Last-Modified")
            if start and validator != state["validator"]:
                raise ValueError("Download revision changed during resume")
            if (
                first != start
                or last < first
                or last >= total
                or len(response.content) != last - first + 1
            ):
                raise ValueError("Download range does not match requested offset or body")
            mode = "ab" if start else "wb"
        elif response.status_code == 200:
            mode, total = "wb", len(response.content)
        else:
            raise ValueError(f"Unexpected download status {response.status_code}")
        with partial.open(mode) as body:
            body.write(response.content)
        state.update(
            {
                "url": url,
                "validator": response.headers.get("ETag") or response.headers.get("Last-Modified"),
                "lastModified": response.headers.get("Last-Modified"),
                "bytes": total,
                "complete": False,
            }
        )
        write_json(receipt, state)
        log.info("%s: %d/%d bytes", path.name, partial.stat().st_size, total)
        if partial.stat().st_size == total:
            break
    with partial.open("rb") as body:
        state["sha256"] = hashlib.file_digest(body, "sha256").hexdigest()
    partial.replace(path)
    state.update(complete=True, fetchedAt=datetime.now(UTC).isoformat())
    write_json(receipt, state)
    return state


def validate_met_header(header: list[str]) -> None:
    missing = MET_COLUMNS - set(header)
    if missing:
        raise RuntimeError(
            f"STOP: Met CSV missing {sorted(missing)}. Actual header: {','.join(header)}"
        )


def fetch_met(client: PoliteClient, out: Path) -> dict:
    revision_path = out / "revision.json"
    if revision_path.exists():
        revision = json.loads(revision_path.read_text())["sha"]
    else:
        response = client.get("https://api.github.com/repos/metmuseum/openaccess/commits/master")
        response.raise_for_status()
        revision = response.json()["sha"]
        write_json(revision_path, {"sha": revision})
    path = out / "MetObjects.csv"
    receipt = download(
        client,
        f"https://media.githubusercontent.com/media/metmuseum/openaccess/{revision}/MetObjects.csv",
        path,
    )
    counts = {"rows": 0, "paintings": 0, "publicDomainPaintings": 0}
    with path.open(encoding="utf-8-sig", newline="") as body:
        reader = csv.DictReader(body)
        validate_met_header(reader.fieldnames or [])
        for row in reader:
            counts["rows"] += 1
            if "Paintings" in row["Classification"]:
                counts["paintings"] += 1
                counts["publicDomainPaintings"] += row["Is Public Domain"] == "True"
    result = {**receipt, **counts, "revision": revision}
    write_json(out / "stats.json", result)
    log.info("Met census: %s", counts)
    if abs(counts["rows"] - 484956) / 484956 > 0.1:
        raise RuntimeError(
            "Met CSV row count differs from the 484,956-row baseline by more than 10%"
        )
    return result


def extract_aic_paintings(archive: Path, out: Path) -> dict:
    receipt = out / "dump-stats.json"
    destination = out / "dump-paintings.jsonl"
    if destination.exists() and receipt.exists():
        return json.loads(receipt.read_text())
    counts = {"rows": 0, "paintings": 0, "paintingsWithImages": 0}
    temporary = destination.with_suffix(".tmp")
    # Read archive members directly; never extract paths supplied by the archive.
    with tarfile.open(archive, "r|bz2") as tar, temporary.open("w") as output:
        for member in tar:
            if (
                not member.isfile()
                or "/artworks/" not in member.name
                or not member.name.endswith(".json")
            ):
                continue
            with tar.extractfile(member) as body:
                row = json.load(body)
            if "artwork_type_title" not in row:
                raise RuntimeError(f"STOP: AIC dump lacks artwork_type_title ({member.name})")
            counts["rows"] += 1
            if row["artwork_type_title"] == "Painting":
                counts["paintings"] += 1
                counts["paintingsWithImages"] += bool(row.get("image_id"))
                output.write(json.dumps(row, ensure_ascii=False) + "\n")
    if not counts["rows"]:
        raise RuntimeError("AIC archive contains no artwork records")
    temporary.replace(destination)
    write_json(receipt, counts)
    log.info("AIC dump census: %s", counts)
    return counts


def fetch_aic_live(client: PoliteClient, out: Path) -> dict:
    after_id, count, total = 0, 0, None
    files = []
    manifest = out / "stats.json"
    previous = json.loads(manifest.read_text()) if manifest.exists() else {}
    stats = {
        "complete": False,
        "rows": 0,
        "files": files,
        "afterId": after_id,
    }
    write_json(out / "stats.json", stats)
    while True:
        path = out / f"paintings-after-{after_id}.json"
        try:
            if path.exists():
                response = json.loads(path.read_text())
            else:
                # Deep page offsets can return a JSON 403 result-limit error.
                # Query the remaining IDs so every request stays on page one.
                params = {
                    "query": {
                        "bool": {
                            "filter": [
                                {"term": {"artwork_type_id": 1}},
                                {"range": {"id": {"gt": after_id}}},
                            ]
                        }
                    },
                    "fields": AIC_FIELDS.split(","),
                    "sort": [{"id": "asc"}],
                    "limit": 100,
                    "page": 1,
                }
                url = "https://api.artic.edu/api/v1/artworks/search?" + urlencode(
                    {"params": json.dumps(params)}
                )
                result = client.get(url, headers={"AIC-User-Agent": client.user_agent})
                if result.is_error:
                    stats.update(httpStatus=result.status_code, error=result.text[:2000])
                result.raise_for_status()
                response = result.json()
            rows = response["data"]
            if any("artwork_type_title" not in row for row in rows):
                raise RuntimeError("AIC live response lacks artwork_type_title")
            if any(row["artwork_type_title"] != "Painting" for row in rows):
                raise RuntimeError("AIC painting query returned a different artwork type")
            remaining = response["pagination"]["total"]
            if total is None:
                total = remaining
            if remaining != total - count:
                raise RuntimeError("AIC census changed during pagination; refresh the snapshot")
            if not rows:
                raise RuntimeError("AIC pagination stalled")
            ids = [row["id"] for row in rows]
            if any(type(id) is not int for id in ids) or any(
                left >= right for left, right in zip([after_id, *ids[:-1]], ids, strict=True)
            ):
                raise RuntimeError("AIC IDs must be strictly increasing; refresh the snapshot")
            if len(rows) > remaining:
                raise RuntimeError("AIC page exceeds its reported total")
            if not path.exists():
                write_json(path, response)
        except Exception as error:
            stats.setdefault("error", str(error))
            write_json(out / "stats.json", stats)
            raise
        count += len(rows)
        after_id = ids[-1]
        files.append(path.name)
        stats.update(rows=count, afterId=after_id, total=total)
        log.info("AIC live: %d/%d paintings, last ID %d", count, total, after_id)
        if count == total:
            stats.update(
                complete=True,
                fetchedAt=previous.get("fetchedAt", datetime.now(UTC).isoformat()),
            )
        write_json(out / "stats.json", stats)
        if stats["complete"]:
            return stats


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fetch resumable corpus metadata; no image downloads"
    )
    for source in ("met", "aic", "wikidata", "cma", "fng"):
        parser.add_argument(f"--{source}", action="store_true")
    parser.add_argument(
        "--aic-live",
        action="store_true",
        help="Also refresh the AIC painting metadata from its live API",
    )
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    settings = get_settings()
    setup_logging(settings)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    out = args.out or settings.scratch_dir / "dumps"
    selected = [name for name in ("met", "aic", "wikidata", "cma", "fng") if getattr(args, name)]
    if not selected:
        parser.error("select --met, --aic, --wikidata, --cma, and/or --fng")
    if args.aic_live and not args.aic:
        parser.error("--aic-live requires --aic")
    # These are the institutions' published metadata endpoints, not website crawling.
    with PoliteClient(
        user_agent=settings.user_agent, robots=False, cache_max_bytes=0, timeout=120
    ) as client:
        if args.met:
            fetch_met(client, out / "met")
        if args.aic:
            archive = out / "aic" / "artic-api-data.tar.bz2"
            receipt = download(client, AIC_ARCHIVE, archive)
            extract_aic_paintings(archive, archive.parent)
            log.info(
                "AIC archive Last-Modified: %s",
                receipt["lastModified"],
            )
            if args.aic_live:
                fetch_aic_live(client, out / "aic" / "live")
        if args.cma:
            from .cma import fetch_cma

            fetch_cma(client, out / "cma")
        if args.fng:
            from .fng import fetch_fng

            fetch_fng(client, out / "fng")
    if args.wikidata:
        from .wikidata_artworks import fetch_artworks

        fetch_artworks(out / "wikidata", user_agent=settings.user_agent)


if __name__ == "__main__":
    main()
