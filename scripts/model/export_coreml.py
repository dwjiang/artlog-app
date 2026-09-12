"""Export C-RADIOv3-B's DINOv2 summary head to the CoreML package the app ships (plan 03.03).

    cd scripts/model && uv run python export_coreml.py --out out/

Writes `out/CRadioV3B.mlpackage`, `out/fakequant_state.pt` (the PyTorch checkpoint with the
phone's int8-rounded weights, consumed by the index build) and `out/model-manifest.json`.

The recipe is decision 001: a fixed INPUT_SIZE RGB image scaled by 1/255 inside CoreML, fp16
compute, symmetric per-channel int8 on the two-dimensional Linear weights only, and an
unnormalized EMBEDDING_DIM float32 output. Any change here is a new model version.
"""

import argparse
import json
import shutil
import sys
import tempfile
import time
from datetime import datetime, timezone
from hashlib import file_digest, sha256
from pathlib import Path

import coremltools as ct
import coremltools.optimize.coreml as cto
import numpy as np
import torch
from coremltools.converters.mil.frontend.milproto.load import load as load_mil

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parents[1]
CACHE = ROOT / "cache"
SHARED_MODEL = json.loads((REPO_ROOT / "shared" / "model-version.json").read_text())

RADIO_REVISION = "c0f37017930e9dda53f93424cf4bf39fc51f287e"
RADIO_VERSION = "c-radio_v3-b"
CHECKPOINT_SHA256 = "530b0e827b1d409ca3b175466e11062885baedd823ec5dae3a88348e76d4c398"
ADAPTOR = "dino_v2"

MODEL_NAME = "CRadioV3B"
INPUT_NAME = "image"
OUTPUT_NAME = "embedding"
INPUT_SIZE = 512
EMBEDDING_DIM = 1536
WEIGHT_DTYPE = "int8"
MODEL_VERSION = f"c-radiov3-b-{WEIGHT_DTYPE}-{INPUT_SIZE}-dinov2-v1"


class DinoSummary(torch.nn.Module):
    def __init__(self, radio):
        super().__init__()
        self.radio = radio

    def forward(self, image):
        return self.radio(image)[ADAPTOR].summary


def build():
    hub = CACHE / "torch-hub"
    hub.mkdir(parents=True, exist_ok=True)
    torch.hub.set_dir(str(hub))
    radio = torch.hub.load(
        f"NVlabs/RADIO:{RADIO_REVISION}",
        "radio_model",
        version=RADIO_VERSION,
        adaptor_names=[ADAPTOR],
        trust_repo=True,
        skip_validation=True,
    )
    checkpoint = hub / "checkpoints" / f"{RADIO_VERSION}_half.pth.tar"
    with checkpoint.open("rb") as file:
        if file_digest(file, "sha256").hexdigest() != CHECKPOINT_SHA256:
            raise RuntimeError("Upstream checkpoint changed; do not reuse this model version")
    return DinoSummary(radio).float().eval()


def assert_recipe_matches_shared_model():
    expected = {"modelVersion": MODEL_VERSION, "inputSize": INPUT_SIZE, "embeddingDim": EMBEDDING_DIM}
    actual = {key: SHARED_MODEL[key] for key in expected}
    if actual != expected:
        raise RuntimeError(f"shared/model-version.json {actual} does not match this export recipe {expected}")


def mil_program(model):
    spec = model.get_spec()
    return load_mil(spec, spec.specificationVersion, file_weights_dir=model.weights_dir)


def convert(model, size):
    example = torch.rand(1, 3, size, size)
    with torch.no_grad():
        output = model(example)
        if output.shape != (1, EMBEDDING_DIM) or not torch.isfinite(output).all():
            raise RuntimeError(f"Unexpected PyTorch output {tuple(output.shape)}")
        traced = torch.jit.trace(model, example)
    return ct.convert(
        traced,
        convert_to="mlprogram",
        compute_precision=ct.precision.FLOAT16,
        inputs=[ct.ImageType(
            name=INPUT_NAME, shape=example.shape, scale=1 / 255.0,
            bias=[0, 0, 0], color_layout=ct.colorlayout.RGB,
        )],
        outputs=[ct.TensorType(name=OUTPUT_NAME, dtype=np.float32)],
        minimum_deployment_target=ct.target.iOS17,
        skip_model_load=True,
    )


def quantize(model, pytorch_model):
    """Int8 per-channel quantization of every two-dimensional Linear weight, plus the PyTorch
    state dict rebuilt from CoreML's own dequantized constants (the index build's weights)."""
    state = {name: tensor.half().float() if tensor.is_floating_point() else tensor
             for name, tensor in pytorch_model.state_dict().items()}
    config = cto.OptimizationConfig()
    selected = {}
    # torch.export prefixes lifted parameter names with p_; tracing does not.
    names = {prefix + name.replace(".", "_") + "_to_fp16": name
             for name in state for prefix in ("", "p_")}
    for op in mil_program(model).functions["main"].operations:
        if op.op_type != "const" or op.name not in names:
            continue
        key = names[op.name]
        if not key.endswith(".weight") or state[key].ndim != 2:
            continue
        np.testing.assert_array_equal(op.val.val, state[key].numpy().astype(np.float16))
        selected[op.name] = key
        config.set_op_name(op.name, cto.OpLinearQuantizerConfig(
            mode="linear_symmetric", dtype=WEIGHT_DTYPE, granularity="per_channel"))
    if not selected:
        raise RuntimeError("No exported weights matched the PyTorch checkpoint")
    compressed = cto.linear_quantize_weights(model, config)
    recovered = set()
    # Read the actual CoreML dequantization result; independently rounding the original fp32
    # tensors would miss fp16 scales and conversion rounding.
    for op in mil_program(compressed).functions["main"].operations:
        if op.op_type != "constexpr_affine_dequantize":
            continue
        source = op.name.removesuffix("_quantized")
        if source not in selected:
            raise RuntimeError(f"Unmapped quantized constant: {op.name}")
        key = selected[source]
        state[key] = torch.from_numpy(op.materialized_val_inference().copy()).float()
        recovered.add(key)
    if recovered != set(selected.values()):
        raise RuntimeError("Not every selected weight was recovered from CoreML")
    return compressed, state, sorted(selected.values())


def directory_sha256(directory):
    digest = sha256()
    for path in sorted(p for p in directory.rglob("*") if p.is_file()):
        digest.update(str(path.relative_to(directory)).encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
    return digest.hexdigest()


def export(out, build=build):
    assert_recipe_matches_shared_model()
    out.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    model = build()
    with tempfile.TemporaryDirectory() as scratch:
        fp16_path = Path(scratch) / "fp16.mlpackage"
        convert(model, INPUT_SIZE).save(str(fp16_path))
        compressed, state, quantized = quantize(ct.models.MLModel(str(fp16_path), skip_model_load=True), model)
    package = out / f"{MODEL_NAME}.mlpackage"
    shutil.rmtree(package, ignore_errors=True)
    compressed.save(str(package))
    torch.save(state, out / "fakequant_state.pt")
    manifest = {
        "modelVersion": MODEL_VERSION,
        "modelName": MODEL_NAME,
        "inputSize": INPUT_SIZE,
        "embeddingDim": EMBEDDING_DIM,
        "inputName": INPUT_NAME,
        "outputName": OUTPUT_NAME,
        "normalizedOutput": False,
        "quantizedWeights": len(quantized),
        "radioRevision": RADIO_REVISION,
        "checkpointSha256": CHECKPOINT_SHA256,
        "weightsSha256": sha256((package / "Data/com.apple.CoreML/weights/weight.bin").read_bytes()).hexdigest(),
        "mlpackageSha256": directory_sha256(package),
        "exportedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "exportSeconds": round(time.perf_counter() - started, 1),
        "coremltoolsVersion": ct.__version__,
        "torchVersion": torch.__version__,
    }
    (out / "model-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=ROOT / "out")
    args = parser.parse_args(argv)
    torch.manual_seed(0)
    print(json.dumps(export(args.out), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
