import json
from io import BytesIO

import numpy as np
import pytest
import torch
from PIL import Image

from pipeline import embed
from pipeline.config import Settings
from pipeline.download import image_filename
from pipeline.embed import embed_shard, read_features, update_manifest
from pipeline.model import Embedder, NonFiniteEmbedding, apply_fakequant, sha256_of
from pipeline.model_version import EMBEDDING_DIM, INPUT_SIZE, MODEL_VERSION, ORB_MAX_KEYPOINTS
from pipeline.orb import DESCRIPTOR_BYTES, KEYPOINT_BYTES


class TinyBackbone(torch.nn.Module):
    """Two Linear layers standing in for RADIO: enough to prove the state-dict contract."""

    def __init__(self):
        super().__init__()
        self.hidden = torch.nn.Linear(3, 8)
        self.head = torch.nn.Linear(8, EMBEDDING_DIM)

    def forward(self, image: torch.Tensor) -> torch.Tensor:
        return self.head(torch.relu(self.hidden(image.mean(dim=(2, 3)))))


class FakeEmbedder:
    device = "cpu"
    dtype_name = "float32"

    def embed(self, batch: torch.Tensor) -> np.ndarray:
        assert isinstance(batch, torch.Tensor)
        means = batch.float().mean(dim=(2, 3)).numpy()
        vectors = np.zeros((len(batch), EMBEDDING_DIM), dtype=np.float32)
        vectors[:, :3] = means + 1
        return vectors / np.linalg.norm(vectors, axis=1, keepdims=True)


def painting(seed: int, size=(160, 120)) -> Image.Image:
    rng = np.random.default_rng(seed)
    return Image.fromarray(rng.integers(0, 255, (size[1], size[0], 3), dtype=np.uint8))


def test_embedder_normalizes_and_returns_float32_vectors():
    embedder = Embedder(TinyBackbone(), "cpu", torch.float32)
    batch = torch.randint(0, 255, (3, 3, 32, 32), dtype=torch.uint8)

    vectors = embedder.embed(batch)

    assert vectors.shape == (3, EMBEDDING_DIM) and vectors.dtype == np.float32
    assert np.allclose(np.linalg.norm(vectors, axis=1), 1.0, atol=1e-5)
    assert np.allclose(vectors, embedder.embed(batch.float() / 255), atol=1e-5)
    with pytest.raises(ValueError):
        embedder.embed(torch.zeros(3, 32, 32))


def test_fakequant_state_must_match_the_model_exactly():
    model = TinyBackbone()
    state = {name: tensor.half().float() for name, tensor in TinyBackbone().state_dict().items()}
    apply_fakequant(model, state)
    assert torch.equal(model.head.weight, state["head.weight"])

    with pytest.raises(ValueError, match="lacks"):
        apply_fakequant(TinyBackbone(), {**state, "extra.weight": torch.zeros(1)})
    with pytest.raises(ValueError, match="misses"):
        apply_fakequant(TinyBackbone(), {"head.weight": state["head.weight"]})


def test_non_finite_output_is_an_error():
    class Broken(torch.nn.Module):
        def forward(self, image):
            return torch.full((image.shape[0], EMBEDDING_DIM), float("nan"))

    with pytest.raises(NonFiniteEmbedding):
        Embedder(Broken(), "cpu", torch.float32).embed(torch.zeros(1, 3, 8, 8))


def test_a_shard_becomes_one_feature_shard_in_row_order(tmp_path):
    images = tmp_path / "images" / "shard-3"
    images.mkdir(parents=True)
    keys = ["wikidata:Q7", "met:12", "aic:5"]
    for index, key in enumerate(keys):
        painting(index).save(images / image_filename(key), "JPEG", quality=90)
    features = tmp_path / "features"

    report = embed_shard(images, features, 3, FakeEmbedder(), batch_size=2, workers=0)

    expected_order = [key for _, key in sorted((image_filename(k), k) for k in keys)]
    assert json.loads((features / "keys-3.json").read_text()) == expected_order
    vectors = np.load(features / "vectors-3.npy")
    assert vectors.shape == (3, EMBEDDING_DIM) and vectors.dtype == np.float32
    assert np.allclose(np.linalg.norm(vectors, axis=1), 1.0, atol=1e-5)
    rows = list(read_features(features, 3))
    assert [key for key, _, _ in rows] == expected_order
    index = json.loads((features / "descriptors-3.json").read_text())
    blob = (features / "descriptors-3.bin").read_bytes()
    assert len(blob) == sum(e["keypointCount"] * (DESCRIPTOR_BYTES + KEYPOINT_BYTES) for e in index)
    for (_, vector, orb), entry in zip(rows, index, strict=True):
        assert orb.count == entry["keypointCount"] > 0
        assert orb.keypoint_array().shape == (orb.count, 4)
        assert (orb.keypoint_array()[:, :2] < INPUT_SIZE).all()
        assert vector.shape == (EMBEDDING_DIM,)
    assert report["images"] == report["vectors"] == 3
    assert report["keypointCount"]["median"] > 0 and report["device"] == "cpu"
    assert not list(features.glob("*.tmp"))


def test_manifest_accumulates_shards_and_run_facts(tmp_path):
    features = tmp_path / "features"
    update_manifest(features, run={"driftCheck": {"passed": True, "mean": 0.997}})
    report = {"shard": 0, "images": 4, "vectors": 4, "device": "mps", "dtype": "float16"}
    update_manifest(features, shard_report=report)
    manifest = update_manifest(
        features, shard_report={**report, "shard": 1, "images": 2, "vectors": 1}
    )

    assert manifest["modelVersion"] == MODEL_VERSION
    assert manifest["driftCheck"]["mean"] == 0.997
    assert manifest["counts"] == {"shards": 2, "images": 6, "vectors": 5}
    assert manifest["device"] == "mps" and manifest["dtype"] == "float16"
    assert json.loads((features / "manifest.json").read_text()) == manifest


def test_empty_shard_writes_empty_feature_files(tmp_path):
    images = tmp_path / "shard-0"
    images.mkdir()
    report = embed_shard(images, tmp_path / "features", 0, FakeEmbedder(), workers=0)
    assert report["images"] == 0
    assert np.load(tmp_path / "features" / "vectors-0.npy").shape == (0, EMBEDDING_DIM)
    assert list(read_features(tmp_path / "features", 0)) == []


def test_jpeg_bytes_survive_letterbox_and_orb_in_the_dataset(tmp_path):
    buffer = BytesIO()
    painting(3, (700, 300)).save(buffer, "JPEG")
    (tmp_path / image_filename("met:1")).write_bytes(buffer.getvalue())
    from pipeline.embed import ShardImages

    key, pixels, orb = ShardImages([tmp_path / image_filename("met:1")])[0]
    assert key == "met:1"
    assert pixels.shape == (3, INPUT_SIZE, INPUT_SIZE) and pixels.dtype == np.uint8
    assert isinstance(pixels, np.ndarray)
    assert orb.count > 0


@pytest.fixture
def standalone_build(tmp_path, monkeypatch):
    weights = tmp_path / "fakequant.pt"
    weights.write_bytes(b"phone-compatible-model-export")
    features = tmp_path / "features"
    for shard in (0, 1):
        images = tmp_path / f"shard-{shard}"
        images.mkdir()
        painting(shard).save(images / image_filename(f"met:{shard}"), "JPEG")
    report = embed_shard(tmp_path / "shard-0", features, 0, FakeEmbedder(), workers=0)
    update_manifest(
        features,
        run={
            "fakequantSha256": sha256_of(weights),
            "driftCheck": {"passed": True, "modelVersion": MODEL_VERSION, "dtype": "float32"},
        },
        shard_report=report,
    )
    monkeypatch.setattr(
        embed, "get_settings", lambda: Settings(_env_file=None, scratch_dir=tmp_path)
    )
    monkeypatch.setattr(embed, "setup_logging", lambda settings: None)
    return (
        weights,
        features,
        [
            "--images",
            str(tmp_path / "shard-1"),
            "--out",
            str(features),
            "--fakequant",
            str(weights),
            "--dtype",
            "float32",
            "--workers",
            "0",
        ],
    )


@pytest.mark.parametrize(
    ("field", "incompatible"),
    [
        ("fakequantSha256", "different-export"),
        ("fakequantSha256", None),
        ("modelVersion", "different-model"),
        ("inputSize", INPUT_SIZE + 1),
        ("embeddingDim", EMBEDDING_DIM + 1),
        ("orbMaxKeypoints", ORB_MAX_KEYPOINTS + 1),
        ("dtype", "float16"),
    ],
)
def test_standalone_resume_rejects_incompatible_features_before_loading_or_writing(
    standalone_build, monkeypatch, field, incompatible
):
    weights, features, args = standalone_build
    manifest_path = features / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    if incompatible is None:
        manifest.pop(field)
    elif field == "fakequantSha256":
        weights.write_bytes(b"incompatible-model-export")
    elif field == "dtype":
        args[args.index("--dtype") + 1] = incompatible
    else:
        manifest[field] = incompatible
    manifest_path.write_text(json.dumps(manifest))
    before = {path.name: path.read_bytes() for path in features.iterdir()}
    loaded = []

    def load(*args, **kwargs):
        loaded.append(True)
        return FakeEmbedder()

    monkeypatch.setattr(embed, "load_embedder", load)
    with pytest.raises(ValueError, match=field):
        embed.main(args)
    assert not loaded
    assert {path.name: path.read_bytes() for path in features.iterdir()} == before


def test_standalone_resume_accepts_same_export_under_a_new_filename(standalone_build, monkeypatch):
    weights, features, args = standalone_build
    copied_weights = weights.with_name("copied-export.pt")
    copied_weights.write_bytes(weights.read_bytes())
    args[args.index("--fakequant") + 1] = str(copied_weights)
    original_vectors = (features / "vectors-0.npy").read_bytes()
    monkeypatch.setattr(embed, "load_embedder", lambda *args, **kwargs: FakeEmbedder())

    assert embed.main(args) == 0

    manifest = json.loads((features / "manifest.json").read_text())
    assert manifest["fakequantSha256"] == sha256_of(weights)
    assert manifest["driftCheck"]["passed"]
    assert manifest["counts"]["shards"] == 2
    assert (features / "vectors-0.npy").read_bytes() == original_vectors
    assert len(list(read_features(features, 1))) == 1


def test_standalone_resume_refuses_feature_files_without_provenance(standalone_build, monkeypatch):
    _, features, args = standalone_build
    (features / "manifest.json").unlink()
    before = {path.name: path.read_bytes() for path in features.iterdir()}
    monkeypatch.setattr(embed, "load_embedder", lambda *args, **kwargs: FakeEmbedder())

    with pytest.raises(ValueError, match="modelVersion"):
        embed.main(args)

    assert {path.name: path.read_bytes() for path in features.iterdir()} == before


def test_fresh_standalone_output_records_provenance_without_claiming_drift_validation(
    standalone_build, monkeypatch
):
    weights, previous, args = standalone_build
    features = previous.with_name("fresh-features")
    args[args.index("--out") + 1] = str(features)
    monkeypatch.setattr(embed, "load_embedder", lambda *args, **kwargs: FakeEmbedder())

    assert embed.main(args) == 0

    manifest = json.loads((features / "manifest.json").read_text())
    assert manifest["fakequantSha256"] == sha256_of(weights)
    assert manifest["modelVersion"] == MODEL_VERSION
    assert manifest["inputSize"] == INPUT_SIZE
    assert manifest["embeddingDim"] == EMBEDDING_DIM
    assert manifest["orbMaxKeypoints"] == ORB_MAX_KEYPOINTS
    assert manifest["dtype"] == "float32"
    assert "driftCheck" not in manifest
