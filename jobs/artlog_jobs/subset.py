"""Package a selected corpus using the existing feature and import formats, entirely offline."""

from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np

from .features import file_hash, read_jsonl, write_jsonl
from .sources.fetch import write_json

if TYPE_CHECKING:
    from .push import Corpus


def export(corpus: "Corpus", out: Path) -> dict:
    if corpus.limit is None:
        raise ValueError("Export requires a small corpus limit")
    keys = sorted({row["viewKey"] for row in corpus.rows["vectors"]})
    if not keys:
        raise ValueError("Cannot export a corpus without features")
    out.mkdir(parents=True, exist_ok=False)
    np.save(out / "vectors-0.npy", np.stack([corpus.features.vectors[key] for key in keys]))
    write_json(out / "keys-0.json", keys)
    index = []
    with (out / "descriptors-0.bin").open("wb") as blob:
        for key in keys:
            features = corpus.features.descriptors(key)
            index.append(
                {"key": key, "offset": blob.tell(), "keypointCount": features["keypointCount"]}
            )
            blob.write(features["descriptors"])
            blob.write(features["keypoints"])
    write_json(out / "descriptors-0.json", index)
    manifest = {
        **corpus.features.manifest,
        "limit": corpus.limit,
        "shardSize": len(keys),
        "shards": {"0": {"vectors": len(keys), "images": len(keys)}},
        "counts": {"shards": 1, "images": len(keys), "vectors": len(keys)},
    }
    write_json(out / "manifest.json", manifest)
    for stage, rows in corpus.rows.items():
        if stage == "penalties":
            continue
        name = {"vectors": "vector-index", "descriptors": "descriptor-index"}.get(stage, stage)
        write_jsonl(out / f"{name}.jsonl", rows)
    selected = {row["key"] for row in corpus.rows["objects"]}
    merges = [
        row for row in read_jsonl(corpus.directory / "merges.jsonl") if row["from"] in selected
    ]
    write_jsonl(out / "merges.jsonl", merges)
    files = sorted(p.name for p in out.iterdir())
    stats = {
        **{
            stage: len(corpus.rows[stage])
            for stage in ("artworks", "objects", "placements", "vectors", "descriptors")
        },
        "completeFeatures": False,
        "expectedShards": 1,
        "merges": len(merges),
        "objectsWithoutFeatures": len(selected - set(keys)),
        "selection": corpus.plan(),
        "files": {name: file_hash(out / name) for name in files},
    }
    write_json(out / "stats.json", stats)
    report = {**corpus.plan(), "packageBytes": sum(p.stat().st_size for p in out.iterdir())}
    write_json(out / "selection.json", report)
    return report
