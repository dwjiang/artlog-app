import numpy as np
import pytest

from pipeline.dedupe import run as dedupe
from pipeline.dedupe import run_delta
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


def write_features(directory, metadata, vectors):
    keys = list(vectors)
    directory.mkdir(parents=True, exist_ok=True)
    np.save(
        directory / "vectors-0.npy", np.stack([vectors[key] for key in keys]).astype(np.float32)
    )
    write_json(directory / "keys-0.json", keys)
    write_json(
        directory / "descriptors-0.json",
        [{"key": key, "offset": i * 48, "keypointCount": 1} for i, key in enumerate(keys)],
    )
    (directory / "descriptors-0.bin").write_bytes(bytes(48 * len(keys)))
    write_json(
        directory / "manifest.json",
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


def axis(index):
    vector = np.zeros(EMBEDDING_DIM, dtype=np.float32)
    vector[index] = 1
    return vector


@pytest.fixture
def delta_package(merged_corpus, tmp_path):
    """Additions to the merged corpus, by default cma:1 duplicating the imported met:0 and a new fng:2. `axes` gives
    each addition's unit vector by the axis it lies on; the imported vectors lie on axis 0."""

    def build(artworks=None, objects=None, placements=None, axes=None, base=None):
        base = base or merged_corpus()
        metadata = tmp_path / "additions"
        new_object = {"source": "corpus", "pageUrl": "https://museum.test/new"}
        artworks = artworks or [
            {
                "key": "cma:1",
                "title": "Painting 0",
                "artist": "Artist 0",
                "rightsStatus": "public_domain",
            },
            {
                "key": "fng:2",
                "title": "Harbor",
                "artist": "Cy Printer",
                "rightsStatus": "public_domain",
            },
        ]
        objects = objects or [
            # The imported met:0 under the same owner and accession: an alias of it.
            {
                **new_object,
                "key": "cma:1",
                "artworkKey": "cma:1",
                "ownerKey": "museum:1",
                "accession": "0",
                "sourceId": "1",
                "imageRef": "https://cma.test/1.jpg",
                "thumbnailUrl": "https://cma.test/1-small.jpg",
            },
            {
                **new_object,
                "key": "fng:2",
                "artworkKey": "fng:2",
                "ownerKey": "museum:2",
                "sourceId": "2",
                "imageRef": "https://fng.test/2.jpg",
            },
        ]
        placements = (
            placements
            if placements is not None
            else [
                {
                    "objectKey": "cma:1",
                    "venueKey": "museum:2",
                    "onView": True,
                    "source": "feed",
                    "confidence": 0.9,
                },
                # The imported survivor already has this placement.
                {
                    "objectKey": "cma:1",
                    "venueKey": "museum:1",
                    "onView": True,
                    "source": "feed",
                    "confidence": 0.9,
                },
                {
                    "objectKey": "fng:2",
                    "venueKey": "museum:2",
                    "onView": False,
                    "source": "feed",
                    "confidence": 0.9,
                },
            ]
        )
        for name, rows in (
            ("artworks", artworks),
            ("objects", objects),
            ("placements", placements),
        ):
            write_jsonl(metadata / f"{name}.jsonl", rows)
        write_json(
            metadata / "stats.json",
            {"artworks": len(artworks), "objects": len(objects), "placements": len(placements)},
        )
        axes = axes or {"cma:1": 1, "fng:2": 2}
        write_features(
            tmp_path / "addition-features", metadata, {key: axis(i) for key, i in axes.items()}
        )
        out = tmp_path / "delta"

        return out, run_delta([base], tmp_path / "addition-features", metadata, out)

    return build
