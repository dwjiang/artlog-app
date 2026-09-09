import argparse
import json
import time
from hashlib import sha256

import coremltools as ct
from coremltools.converters.mil.frontend.milproto.load import load as load_mil
import coremltools.optimize.coreml as cto
import numpy as np
import torch

from wrapper import ARTIFACTS, EMBEDDING_DIM, RADIO_REVISION, build


def mil_program(model):
    spec = model.get_spec()
    return load_mil(spec, spec.specificationVersion, file_weights_dir=model.weights_dir)


def quantize(model, pytorch_model, variant, size):
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
        if variant == "int8":
            options = cto.OpLinearQuantizerConfig(mode="linear_symmetric", dtype="int8", granularity="per_channel")
        else:
            options = cto.OpPalettizerConfig(mode="kmeans", nbits=4)
        config.set_op_name(op.name, options)
    if not selected:
        raise RuntimeError("No exported weights matched the PyTorch checkpoint")
    if variant == "int8":
        compressed = cto.linear_quantize_weights(model, config)
        recovered = set()
        # Read the actual CoreML dequantization result; independently rounding the
        # original fp32 tensors would miss fp16 scales and conversion rounding.
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
        fakequant = ARTIFACTS / "fakequant_state.pt"
        if fakequant.exists():
            previous = torch.load(fakequant, weights_only=True)
            if previous.keys() != state.keys() or any(not torch.equal(previous[k], v) for k, v in state.items()):
                raise RuntimeError("Quantized weights differ between resolutions; use a new model version")
        else:
            torch.save(state, fakequant)
    else:
        compressed = cto.palettize_weights(model, config)
    (ARTIFACTS / f"quantized-weights-{size}-{variant}.json").write_text(json.dumps(selected, indent=2) + "\n")
    return compressed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--size", type=int, choices=(448, 512), default=512)
    parser.add_argument("--frontend", choices=("trace", "export"), default="trace")
    parser.add_argument("--precision", choices=("fp16",), default="fp16")
    parser.add_argument("--weights", choices=("fp16", "int8", "int4"), default="fp16")
    args = parser.parse_args()
    torch.manual_seed(0)
    model = build()
    example = torch.rand(1, 3, args.size, args.size)
    started = time.perf_counter()
    fp16_path = ARTIFACTS / f"cradio-v3b-dino-{args.size}-fp16.mlpackage"
    with torch.no_grad():
        output = model(example)
        assert output.shape == (1, EMBEDDING_DIM) and torch.isfinite(output).all()
        if args.weights != "fp16":
            converted = ct.models.MLModel(str(fp16_path), skip_model_load=True)
            converted = quantize(converted, model, args.weights, args.size)
        elif args.frontend == "trace":
            captured = torch.jit.trace(model, example)
        else:
            captured = torch.export.export(model, (example,)).run_decompositions({})
    if args.weights == "fp16":
        converted = ct.convert(
            captured,
            convert_to="mlprogram",
            compute_precision=ct.precision.FLOAT16,
            inputs=[ct.ImageType(
                name="image", shape=example.shape, scale=1 / 255.0,
                bias=[0, 0, 0], color_layout=ct.colorlayout.RGB,
            )],
            outputs=[ct.TensorType(name="embedding", dtype=np.float32)],
            minimum_deployment_target=ct.target.iOS17,
            skip_model_load=True,
        )
    destination = ARTIFACTS / f"cradio-v3b-dino-{args.size}-{args.weights}.mlpackage"
    converted.save(str(destination))
    report = {
        "radio_revision": RADIO_REVISION,
        "size": args.size,
        "variant": args.weights,
        "frontend": args.frontend,
        "export_seconds": time.perf_counter() - started,
        "package_bytes": sum(p.stat().st_size for p in destination.rglob("*") if p.is_file()),
        "weights_sha256": sha256((destination / "Data/com.apple.CoreML/weights/weight.bin").read_bytes()).hexdigest(),
    }
    destination.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
