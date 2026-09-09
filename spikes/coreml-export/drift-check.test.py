import json
from hashlib import sha256
import sys
from unittest.mock import Mock

import numpy as np
from PIL import Image
import pytest
import torch

import drift_check


@pytest.fixture
def inputs(tmp_path, monkeypatch):
    artifacts = tmp_path / "artifacts"
    calibration = tmp_path / "calibration"
    artifacts.mkdir()
    calibration.mkdir()
    urls = ["https://example.com/one", "https://example.com/two"]
    vectors = [[1, 0], [0, 1]]
    (calibration / "urls.txt").write_text("\n".join(urls) + "\n")
    (calibration / "manifest.json").write_text("[]")
    (calibration / "iphone-embeddings.json").write_text(json.dumps(dict(zip(urls, vectors))))
    metadata = {"weights_sha256": "same-weights", "size": 512, "compute_units": "cpuAndNeuralEngine"}
    (calibration / "iphone-report.json").write_text(json.dumps(metadata))
    (artifacts / "cradio-v3b-dino-512-int8.json").write_text(json.dumps(metadata))
    torch.save({}, artifacts / "fakequant_state.pt")
    image = tmp_path / "painting.png"
    Image.new("RGB", (2, 2)).save(image)
    monkeypatch.setattr(drift_check, "ARTIFACTS", artifacts)
    monkeypatch.setattr(drift_check, "CALIBRATION", calibration)
    monkeypatch.setattr(drift_check, "image_path", lambda url: image)
    monkeypatch.setattr(drift_check, "build", Mock())
    monkeypatch.setattr(drift_check, "pytorch_embeddings", Mock(return_value=np.array(vectors)))
    monkeypatch.setattr(drift_check, "coreml_embeddings", Mock(side_effect=AssertionError("CoreML unavailable")))
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setattr(sys, "argv", ["drift_check.py", "--torch-device", "cuda",
                                     "--iphone", str(calibration / "iphone-embeddings.json")])
    return artifacts, calibration, vectors


def test_linux_compares_cuda_outputs_with_iphone_without_coreml(inputs):
    artifacts, _, _ = inputs
    drift_check.main()
    report = json.loads((artifacts / "drift-512.json").read_text())
    assert report["torch_device"] == "cuda"
    assert report["cosines"]["fakequant_iphone_int8"] == {"mean": 1.0, "min": 1.0, "count": 2}
    assert report["mac_load_ms"] == {}
    assert "skipped" in report["scope"]
    assert not any("coreml" in key for key in report["cosines"])
    assert all(call.kwargs["device"] == "cuda" for call in drift_check.pytorch_embeddings.call_args_list)


def test_linux_requires_iphone_reference_before_loading_models(inputs, monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["drift_check.py", "--torch-device", "cuda"])
    with pytest.raises(SystemExit) as error:
        drift_check.main()
    assert error.value.code == 2
    assert "--iphone" in capsys.readouterr().err
    drift_check.build.assert_not_called()


def test_linux_rejects_reference_from_different_export(inputs):
    _, calibration, _ = inputs
    path = calibration / "iphone-report.json"
    metadata = json.loads(path.read_text())
    metadata["weights_sha256"] = "different-weights"
    path.write_text(json.dumps(metadata))
    with pytest.raises(ValueError, match="does not match this export"):
        drift_check.main()


def test_macos_still_compares_all_coreml_variants(inputs, monkeypatch):
    artifacts, _, vectors = inputs
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setattr(sys, "argv", ["drift_check.py"])
    monkeypatch.setattr(drift_check, "coreml_embeddings", Mock(return_value=(np.array(vectors), 42)))
    drift_check.main()
    report = json.loads((artifacts / "drift-512.json").read_text())
    assert report["torch_device"] == "mps"
    assert report["mac_load_ms"] == {"fp16": 42, "int8": 42, "int4": 42}
    for variant in ("fp16", "int8", "int4"):
        assert report["cosines"][f"fakequant_coreml_{variant}"]["min"] == 1.0


def test_cuda_builds_its_own_index_and_reuses_it(inputs, monkeypatch):
    artifacts, calibration, vectors = inputs
    index_file = calibration / "index-urls.txt"
    index_file.write_text("".join(f"https://example.com/index/{i}\n" for i in range(2000)))
    signature = sha256(index_file.read_bytes() + (artifacts / "fakequant_state.pt").read_bytes()).hexdigest()
    wrong_index = np.full((2000, 2), np.nan)
    np.savez(artifacts / "index-512-mps.npz", signature=signature, vectors=wrong_index)
    np.savez(artifacts / "index-512.npz", signature=signature, vectors=wrong_index)
    queries = np.array(vectors)
    inference = Mock(side_effect=[queries, queries, np.tile(queries, (1000, 1))])
    monkeypatch.setattr(drift_check, "pytorch_embeddings", inference)
    drift_check.main()
    report = json.loads((artifacts / "drift-512.json").read_text())
    assert report["top1_agreement_percent"]["iphone_int8"] == 100

    inference.side_effect = [queries, queries]
    drift_check.main()
    assert json.loads((artifacts / "drift-512.json").read_text())["top1_agreement_percent"] == report["top1_agreement_percent"]
