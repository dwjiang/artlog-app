import argparse
import csv
import hashlib
import random
from pathlib import Path

import httpx

from probe import Probe, UA, now, save

BASE = "https://collectionapi.metmuseum.org/public/collection/v1"


def count_rows(rows):
    counts = {"rows": 0, "paintings": 0, "public_domain_paintings": 0, "public_domain_paintings_on_view": 0, "public_domain_paintings_wikidata": 0}
    eligible = []
    for row in rows:
        counts["rows"] += 1
        if row["Classification"] != "Paintings":
            continue
        counts["paintings"] += 1
        if row["Is Public Domain"].lower() != "true":
            continue
        counts["public_domain_paintings"] += 1
        counts["public_domain_paintings_on_view"] += bool(row.get("Gallery Number", "").strip())
        counts["public_domain_paintings_wikidata"] += bool(row.get("Object Wikidata URL", "").strip())
        eligible.append(int(row["Object ID"]))
    return counts, sorted(eligible)


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", type=Path, default=Path("../../.context/data-sources/MetObjects.csv"))
    parser.add_argument("--sample-size", type=int, default=30, choices=range(1, 101))
    args = parser.parse_args()
    probe = Probe()
    output = {"started_at": now()}
    args.csv.parent.mkdir(parents=True, exist_ok=True)
    if not args.csv.exists():
        _, commit = probe.json("https://api.github.com/repos/metmuseum/openaccess/commits/master")
        if not commit or not commit.get("sha"):
            output.update(counts=None, reason="CSV revision discovery failed; no local snapshot is available.", requests=probe.records)
            save("met", output)
            return
        revision = commit["sha"]
        url = f"https://media.githubusercontent.com/media/metmuseum/openaccess/{revision}/MetObjects.csv"
        with httpx.stream("GET", url, headers={"User-Agent": UA}, timeout=65, follow_redirects=True) as response:
            response.raise_for_status()
            partial = args.csv.with_suffix(".partial")
            with partial.open("wb") as target:
                for chunk in response.iter_bytes():
                    target.write(chunk)
            partial.replace(args.csv)
        args.csv.with_suffix(".source").write_text(url)
    recorded_source = args.csv.with_suffix(".source")
    output["csv_url"] = recorded_source.read_text() if recorded_source.exists() else "unknown: caller-supplied local CSV"
    output["revision"] = output["csv_url"].rsplit("/", 2)[-2] if output["csv_url"].startswith("https://media.githubusercontent.com/") else None
    output["bytes"] = args.csv.stat().st_size
    with args.csv.open("rb") as source:
        output["sha256"] = hashlib.file_digest(source, "sha256").hexdigest()
    with args.csv.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        output["csv_fields"] = reader.fieldnames
        output["counts"], eligible = count_rows(reader)
    output["primary_image_small_count"] = None
    output["primary_image_small_reason"] = "CSV has no image URLs; bounded API sample is not a census."
    output["sample"] = {"method": "random.sample on sorted eligible IDs; seed 5", "objects": []}
    output["requests"] = probe.records.copy()
    fields = ["objectID", "classification", "isPublicDomain", "primaryImageSmall", "GalleryNumber", "objectWikidata_URL", "accessionNumber"]
    for object_id in random.Random(5).sample(eligible, min(args.sample_size, len(eligible))):
        record, data = probe.json(BASE + f"/objects/{object_id}")
        output["sample"]["objects"].append({"request": record, "data": {k: data.get(k) for k in fields} if data else None})
    save("met", output)


if __name__ == "__main__":
    run()
