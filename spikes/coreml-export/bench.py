import argparse
import json
import subprocess

from wrapper import ARTIFACTS

BUNDLE = "app.artlog.coremlbench"


def run(device, size, weights, units):
    name = f"cradio-v3b-dino-{size}-{weights}"
    results = ARTIFACTS / "iphone"
    results.mkdir(exist_ok=True)
    base = ["xcrun", "devicectl", "device"]
    domain = ["--device", device, "--domain-type", "appDataContainer", "--domain-identifier", BUNDLE]
    log = results / f"{name}-{units}.log"
    with log.open("w") as output:
        subprocess.run(base + ["copy", "to"] + domain + [
            "--source", str(ARTIFACTS / f"{name}.mlpackage"),
            "--source", str(ARTIFACTS / f"calibration-{size}"), "--destination", "Documents",
        ], check=True, stdout=output, stderr=subprocess.STDOUT)
        subprocess.run(base + ["process", "launch", "--device", device,
            "--timeout", "300",
            "--terminate-existing", "--console", BUNDLE, "--model", name,
            "--size", str(size), "--units", units, "--exit-after-run",
        ], check=True, stdout=output, stderr=subprocess.STDOUT)
        for suffix in ("report", "embeddings"):
            filename = f"{name}-{units}-{suffix}.json"
            subprocess.run(base + ["copy", "from"] + domain + [
                "--source", f"Documents/{filename}", "--destination", str(results / filename),
            ], check=True, stdout=output, stderr=subprocess.STDOUT)
    report = json.loads((results / f"{name}-{units}-report.json").read_text())
    expected = json.loads((ARTIFACTS / f"{name}.json").read_text())
    if report["weights_sha256"] != expected["weights_sha256"]:
        raise ValueError("iPhone model weights differ from the local export")
    print(f"{name}, {units}: {report['prediction_median_ms']:.2f} ms", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", required=True)
    parser.add_argument("--size", type=int, choices=(448, 512), default=512)
    parser.add_argument("--weights", choices=("fp16", "int8", "int4"), default="int8")
    parser.add_argument("--units", choices=("all", "cpuAndNeuralEngine"), default="cpuAndNeuralEngine")
    args = parser.parse_args()
    run(args.device, args.size, args.weights, args.units)
