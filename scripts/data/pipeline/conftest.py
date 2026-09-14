import numpy as np
import pytest

from pipeline.dedupe import run as dedupe
from pipeline.download import iter_tasks, task_fingerprint
from pipeline.features import write_jsonl
from pipeline.hubs import run as hubs
from pipeline.model_version import EMBEDDING_DIM, INPUT_SIZE, MODEL_VERSION, ORB_MAX_KEYPOINTS
from pipeline.sources.fetch import write_json


@pytest.fixture
def merged_corpus(tmp_path):
    def build(count=3):
        metadata, features, merged = (tmp_path / p for p in ("metadata", "features", "merged"))
        features.mkdir(exist_ok=True)
        artworks = [
            {
                "key": f"art:{i}",
                "title": f"Painting {i}",
                "artist": f"Artist {i}",
                "rightsStatus": "public_domain",
                "multiplicity": "unique",
            }
            for i in range(count)
        ]
        objects = [
            {
                "key": f"met:{i}",
                "artworkKey": f"art:{i}",
                "ownerKey": "museum:1",
                "accession": str(i),
                "source": "corpus",
                "sourceId": str(i),
                "imageRef": f"https://museum.test/{i}.jpg",
                "pageUrl": f"https://museum.test/{i}",
                "thumbnailUrl": f"https://museum.test/{i}.jpg",
            }
            for i in range(count)
        ]
        # A second view merges by accession, while the last object has no features.
        objects.append({**objects[0], "key": "wikidata:Q1"})
        placements = [
            {
                "objectKey": o["key"],
                "venueKey": "museum:1",
                "onView": True,
                "source": "feed",
                "confidence": 0.9,
            }
            for o in objects
        ]
        for name, rows in (
            ("artworks", artworks),
            ("objects", objects),
            ("placements", placements),
        ):
            write_jsonl(metadata / f"{name}.jsonl", rows)
        write_json(
            metadata / "stats.json",
            {"artworks": count, "objects": count + 1, "placements": count + 1},
        )
        keys = [o["key"] for o in objects if o["key"] != f"met:{count - 1}"]
        matrix = np.zeros((len(keys), EMBEDDING_DIM), dtype=np.float32)
        matrix[:, 0] = 1
        np.save(features / "vectors-0.npy", matrix)
        write_json(features / "keys-0.json", keys)
        write_json(
            features / "descriptors-0.json",
            [{"key": key, "offset": i * 48, "keypointCount": 1} for i, key in enumerate(keys)],
        )
        (features / "descriptors-0.bin").write_bytes(bytes(48 * len(keys)))
        write_json(
            features / "manifest.json",
            {
                "modelVersion": MODEL_VERSION,
                "inputSize": INPUT_SIZE,
                "embeddingDim": EMBEDDING_DIM,
                "orbMaxKeypoints": ORB_MAX_KEYPOINTS,
                "shardSize": 10000,
                "limit": None,
                "downloadInputsSha256": task_fingerprint(iter_tasks(metadata / "objects.jsonl")),
                "shards": {"0": {"vectors": len(keys)}},
                "counts": {"vectors": len(keys)},
                "driftCheck": {"passed": True, "mean": 1, "min": 1},
            },
        )
        dedupe(features, metadata, merged)
        hubs(merged, merged / "penalties.jsonl")
        return merged

    return build
