import json
from hashlib import sha256
from pathlib import Path

import bench
import pytest


def result():
    return {
        "weights_sha256": sha256(b"exported weights").hexdigest(),
        "size": 512,
        "compute_units": "cpuAndNeuralEngine",
        "embedding_count": 1,
        "prediction_median_ms": 67,
    }, {"https://example.test/painting": [1.0] + [0.0] * 1535}


def test_device_run_consumes_the_exported_package_and_preserves_previous_results(
    tmp_path, monkeypatch
):
    model = tmp_path / "export/CRadioV3B.mlpackage"
    weights = model / "Data/com.apple.CoreML/weights/weight.bin"
    weights.parent.mkdir(parents=True)
    weights.write_bytes(b"exported weights")
    artifacts = tmp_path / "artifacts"
    calibration = artifacts / "calibration-512"
    calibration.mkdir(parents=True)
    (calibration / "manifest.json").write_text(
        json.dumps([{"url": "https://example.test/painting"}])
    )
    monkeypatch.setattr(bench, "ARTIFACTS", artifacts)
    calls = []
    report, embeddings = result()

    def device_command(args, **kwargs):
        calls.append(args)
        assert kwargs["check"] is True
        if args[3:5] == ["copy", "from"]:
            source = args[args.index("--source") + 1]
            target = args[args.index("--destination") + 1]
            Path(target).write_text(
                json.dumps(report if source.endswith("-report.json") else embeddings)
            )

    monkeypatch.setattr(bench.subprocess, "run", device_command)
    output = tmp_path / "results/run-001"
    bench.run("test-device", model, 512, "cpuAndNeuralEngine", output)
    assert len(calls) == 4
    assert str(model) in calls[0] and str(calibration) in calls[0]
    assert calls[1][calls[1].index("--model") + 1] == "CRadioV3B"
    saved = output / "CRadioV3B-cpuAndNeuralEngine-report.json"
    assert json.loads(saved.read_text()) == report
    with pytest.raises(FileExistsError):
        bench.run("test-device", model, 512, "cpuAndNeuralEngine", output)
    assert len(calls) == 4


@pytest.mark.parametrize(
    "fault", ["weights", "size", "units", "missing", "dimensions", "nonfinite", "zero"]
)
def test_stale_incomplete_or_invalid_device_results_are_rejected(fault):
    report, embeddings = result()
    expected = {
        "weights_hash": report["weights_sha256"],
        "size": 512,
        "units": "cpuAndNeuralEngine",
        "urls": list(embeddings),
    }
    url = next(iter(embeddings))
    if fault == "weights":
        report["weights_sha256"] = "other-export"
    elif fault == "size":
        report["size"] = 448
    elif fault == "units":
        report["compute_units"] = "all"
    elif fault == "missing":
        embeddings.clear()
    elif fault == "dimensions":
        embeddings[url].pop()
    elif fault == "nonfinite":
        embeddings[url][0] = float("nan")
    else:
        embeddings[url][0] = 0
    with pytest.raises(ValueError):
        bench.validate_results(report, embeddings, **expected)
