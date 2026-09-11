import argparse
import json
import logging
import math
import shutil
import time
import unicodedata
from collections import defaultdict
from pathlib import Path

import numpy as np

from .config import get_settings, setup_logging
from .download import iter_tasks, task_fingerprint
from .features import Features, file_hash, read_jsonl, write_jsonl
from .rights import merge_rights
from .sources.fetch import write_json

log = logging.getLogger(__name__)


def priority(key: str) -> tuple[bool, str]:
    return (key.split(":", 1)[0] not in {"met", "aic"}, key)


def accession(value: str | None) -> str:
    normalized = " ".join(unicodedata.normalize("NFKC", value or "").casefold().split())
    return normalized if any(c.isalnum() for c in normalized) else ""


def artist(value: str) -> str:
    normalized = " ".join(unicodedata.normalize("NFKC", value).casefold().split())
    unknown = {"", "unknown", "unknown artist", "anonymous", "unidentified", "unidentified artist"}
    return "" if any(name.strip() in unknown for name in normalized.split(";")) else normalized


def find_merges(objects: list[dict], vectors: dict, artists: dict, *, block_size=1024):
    parents = {row["key"]: row["key"] for row in objects}
    sources = {row["key"]: {row["key"].split(":", 1)[0]} for row in objects}
    accessions = {
        row["key"]: {number} if (number := accession(row.get("accession"))) else set()
        for row in objects
    }
    rules = {}

    def root(key):
        while parents[key] != key:
            parents[key] = parents[parents[key]]
            key = parents[key]
        return key

    def merge(a, b, rule):
        a, b = root(a), root(b)
        if a == b:
            return
        # An alias must not bridge distinct source records or conflicting accessions.
        if rule == "embedding" and (
            sources[a] & sources[b] or len(accessions[a] | accessions[b]) > 1
        ):
            return
        survivor, duplicate = sorted((a, b), key=priority)
        parents[duplicate] = survivor
        sources[survivor].update(sources.pop(duplicate))
        accessions[survivor].update(accessions.pop(duplicate))
        rules[duplicate] = rule

    groups = defaultdict(list)
    for row in sorted(objects, key=lambda o: priority(o["key"])):
        if row.get("ownerKey") and (number := accession(row.get("accession"))):
            groups[row["ownerKey"], number].append(row["key"])
    for keys in groups.values():
        for key in keys[1:]:
            merge(keys[0], key, "accession")
    groups.clear()
    for row in sorted(objects, key=lambda o: priority(o["key"])):
        key = row["key"]
        if row.get("ownerKey") and key in vectors and (name := artist(artists.get(key, ""))):
            groups[row["ownerKey"], name].append(key)
    for keys in groups.values():
        if len(keys) < 2:
            continue
        matrix = np.stack([vectors[key] for key in keys])
        for start in range(0, len(keys), block_size):
            for other in range(start, len(keys), 20000):
                scores = matrix[start : start + block_size] @ matrix[other : other + 20000].T
                left, right = np.where(scores >= 0.95)
                for i, j in zip(left + start, right + other, strict=True):
                    if i < j:
                        merge(keys[i], keys[j], "embedding")
    mapping = {key: root(key) for key in sorted(parents)}
    audit = [{"from": key, "into": mapping[key], "rule": rules[key]} for key in sorted(rules)]
    return mapping, audit


def merge_display_metadata(artworks: list[dict], objects: list[dict], mapping: dict[str, str]):
    works = {row["key"]: dict(row) for row in artworks}
    merged = {row["key"]: dict(row) for row in objects}
    linked_works = defaultdict(set)
    for key, target in mapping.items():
        artwork, other = merged[key]["artworkKey"], merged[target]["artworkKey"]
        if artwork != other:
            linked_works[artwork].add(other)
            linked_works[other].add(artwork)
        if key != target:
            merged[key]["mergedIntoKey"] = target

    # An artwork can span several object groups; rights must reach every connected artwork.
    visited = set()
    for key in linked_works:
        if key in visited:
            continue
        component, pending = set(), [key]
        while pending:
            current = pending.pop()
            if current in component:
                continue
            component.add(current)
            pending.extend(linked_works[current] - component)
        visited.update(component)
        rights = merge_rights(works[key]["rightsStatus"] for key in component)
        for key in component:
            works[key]["rightsStatus"] = rights

    thumbnails = {}
    for row in sorted(merged.values(), key=lambda row: priority(row["key"])):
        if works[row["artworkKey"]]["rightsStatus"] != "public_domain":
            row.pop("thumbnailUrl", None)
        elif row.get("thumbnailUrl"):
            thumbnails.setdefault(mapping[row["key"]], row["thumbnailUrl"])
    for key, thumbnail in thumbnails.items():
        merged[key]["thumbnailUrl"] = thumbnail
    return list(works.values()), sorted(
        merged.values(), key=lambda row: ("mergedIntoKey" in row, priority(row["key"]))
    )


def run(features: Path, metadata: Path, out: Path) -> dict:
    started = time.monotonic()
    if out.resolve() in {features.resolve(), metadata.resolve()}:
        raise ValueError("Merged output must be separate from its inputs")
    metadata_stats = json.loads((metadata / "stats.json").read_text())
    artworks = read_jsonl(metadata / "artworks.jsonl")
    objects = read_jsonl(metadata / "objects.jsonl")
    placements = read_jsonl(metadata / "placements.jsonl")
    for name, rows in (("artworks", artworks), ("objects", objects), ("placements", placements)):
        if len(rows) != metadata_stats[name]:
            raise ValueError(f"Metadata {name} count disagrees with stats.json")
    works = {row["key"]: row for row in artworks}
    by_key = {row["key"]: row for row in objects}
    if len(works) != len(artworks) or len(by_key) != len(objects):
        raise ValueError("Duplicate metadata keys")
    data = Features(features)
    if data.manifest.get("downloadInputsSha256") != task_fingerprint(
        iter_tasks(metadata / "objects.jsonl")
    ):
        raise ValueError("Feature download inputs do not match metadata; rebuild the features")
    if set(data.vectors) - by_key.keys():
        raise ValueError("Feature keys missing from metadata")
    artists = {row["key"]: works[row["artworkKey"]]["artist"] for row in objects}
    mapping, merges = find_merges(objects, data.vectors, artists)
    artworks, merged_objects = merge_display_metadata(artworks, objects, mapping)
    merged_placements = {}
    # Prefer the survivor's placement when two source records describe the same placement.
    for row in sorted(
        placements,
        key=lambda p: (mapping[p["objectKey"]] != p["objectKey"], priority(p["objectKey"])),
    ):
        target = mapping[row["objectKey"]]
        key = target, row["venueKey"], row["source"]
        merged_placements.setdefault(key, {**row, "objectKey": target})
    vector_index = [
        {"objectKey": mapping[key], "viewKey": key, "source": by_key[key]["source"]}
        for key in sorted(data.vectors, key=priority)
    ]
    descriptor_keys = {}
    for row in vector_index:
        descriptor_keys.setdefault(row["objectKey"], row["viewKey"])
    out.mkdir(parents=True, exist_ok=True)
    (out / "stats.json").unlink(missing_ok=True)
    # Copy only files named by the captured manifest; the producer may be writing another shard.
    for name in data.files:
        if name != "manifest.json":
            temporary = out / (name + ".tmp")
            shutil.copyfile(features / name, temporary)
            temporary.replace(out / name)
    write_json(out / "manifest.json", data.manifest)
    for name, rows in (
        ("artworks", artworks),
        ("objects", merged_objects),
        ("placements", [merged_placements[k] for k in sorted(merged_placements)]),
        ("merges", merges),
        ("vector-index", vector_index),
        (
            "descriptor-index",
            [
                {"objectKey": key, "viewKey": value}
                for key, value in sorted(descriptor_keys.items())
            ],
        ),
    ):
        write_jsonl(out / f"{name}.jsonl", rows)
    planned_images = sum(bool(row.get("imageRef")) for row in objects)
    shard_size = data.manifest.get("shardSize")
    expected_shards = math.ceil(planned_images / shard_size) if shard_size else None
    complete_features = (
        data.manifest.get("limit") is None
        and expected_shards is not None
        and set(data.manifest["shards"]) == {str(i) for i in range(expected_shards)}
    )
    stats = {
        "expectedShards": expected_shards,
        "completeFeatures": complete_features,
        "artworks": len(artworks),
        "objects": len(objects),
        "placements": len(merged_placements),
        "vectors": len(vector_index),
        "descriptors": len(descriptor_keys),
        "merges": len(merges),
        "objectsWithoutFeatures": len(by_key.keys() - data.vectors.keys()),
        "seconds": round(time.monotonic() - started, 2),
    }
    files = data.files + [
        f"{name}.jsonl"
        for name in (
            "artworks",
            "objects",
            "placements",
            "merges",
            "vector-index",
            "descriptor-index",
        )
    ]
    stats["files"] = {name: file_hash(out / name) for name in sorted(files)}
    write_json(out / "stats.json", stats)
    log.info("Dedupe: %s", {k: v for k, v in stats.items() if k != "files"})
    return stats


def main():
    parser = argparse.ArgumentParser(description="Deduplicate within an owner and retain all views")
    parser.add_argument("--features", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    setup_logging(get_settings())
    result = run(args.features, args.metadata, args.out)
    print(json.dumps({k: v for k, v in result.items() if k != "files"}))


if __name__ == "__main__":
    main()
