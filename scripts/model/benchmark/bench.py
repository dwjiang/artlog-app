import argparse
import json
import math
import subprocess
from hashlib import file_digest
from pathlib import Path

from calibration import ARTIFACTS, ROOT

BUNDLE = "app.artlog.coremlbench"


def validate_results(report, embeddings, *, weights_hash, size, units, urls):
    if report["weights_sha256"] != weights_hash:
        raise ValueError("iPhone model weights differ from the local export")
    if report["size"] != size or report["compute_units"] != units:
        raise ValueError(
            "iPhone benchmark configuration differs from the requested run"
        )
    if set(embeddings) != set(urls) or report["embedding_count"] != len(urls):
        raise ValueError("iPhone results do not cover every prepared calibration image")
    for vector in embeddings.values():
        if (
            len(vector) != 1536
            or not all(math.isfinite(value) for value in vector)
            or not any(vector)
        ):
            raise ValueError("iPhone returned an invalid embedding")


def run(device, model, size, units, results):
    model = Path(model).resolve()
    if model.suffix != ".mlpackage":
        raise ValueError("model must be an exported .mlpackage")
    with (model / "Data/com.apple.CoreML/weights/weight.bin").open("rb") as weights:
        weights_hash = file_digest(weights, "sha256").hexdigest()
    calibration = ARTIFACTS / f"calibration-{size}"
    manifest = json.loads((calibration / "manifest.json").read_text())
    urls = [record["url"] for record in manifest]
    if not urls or len(urls) != len(set(urls)):
        raise ValueError("Prepared calibration URLs must be nonempty and unique")
    name = model.stem
    results = Path(results)
    results.mkdir(parents=True, exist_ok=False)
    base = ["xcrun", "devicectl", "device"]
    domain = [
        "--device",
        device,
        "--domain-type",
        "appDataContainer",
        "--domain-identifier",
        BUNDLE,
    ]
    log = results / f"{name}-{units}.log"
    with log.open("w") as output:
        subprocess.run(
            base
            + ["copy", "to"]
            + domain
            + [
                "--source",
                str(model),
                "--source",
                str(calibration),
                "--destination",
                "Documents",
            ],
            check=True,
            stdout=output,
            stderr=subprocess.STDOUT,
        )
        subprocess.run(
            base
            + [
                "process",
                "launch",
                "--device",
                device,
                "--timeout",
                "300",
                "--terminate-existing",
                "--console",
                BUNDLE,
                "--model",
                name,
                "--size",
                str(size),
                "--units",
                units,
                "--exit-after-run",
            ],
            check=True,
            stdout=output,
            stderr=subprocess.STDOUT,
        )
        for suffix in ("report", "embeddings"):
            filename = f"{name}-{units}-{suffix}.json"
            subprocess.run(
                base
                + ["copy", "from"]
                + domain
                + [
                    "--source",
                    f"Documents/{filename}",
                    "--destination",
                    str(results / filename),
                ],
                check=True,
                stdout=output,
                stderr=subprocess.STDOUT,
            )
    report = json.loads((results / f"{name}-{units}-report.json").read_text())
    embeddings = json.loads((results / f"{name}-{units}-embeddings.json").read_text())
    validate_results(
        report, embeddings, weights_hash=weights_hash, size=size, units=units, urls=urls
    )
    print(f"{name}, {units}: {report['prediction_median_ms']:.2f} ms", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", required=True)
    parser.add_argument("--size", type=int, choices=(448, 512), default=512)
    parser.add_argument(
        "--model", type=Path, default=ROOT.parent / "out/CRadioV3B.mlpackage"
    )
    parser.add_argument(
        "--out",
        type=Path,
        required=True,
        help="New directory for this run's log, report and embeddings",
    )
    parser.add_argument(
        "--units", choices=("all", "cpuAndNeuralEngine"), default="cpuAndNeuralEngine"
    )
    args = parser.parse_args()
    run(args.device, args.model, args.size, args.units, args.out)
