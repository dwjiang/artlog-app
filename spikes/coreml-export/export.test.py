import json
import sys

import coremltools as ct
import numpy as np
import pytest
import torch

import export


class ImageSummary(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.radio = torch.nn.Linear(3, export.EMBEDDING_DIM)

    def forward(self, image):
        return self.radio(image.mean(dim=(-2, -1)))


@pytest.mark.parametrize("frontend", ["trace", "export"])
def test_cli_frontends_produce_quantized_image_models(tmp_path, monkeypatch, frontend):
    monkeypatch.setattr(export, "ARTIFACTS", tmp_path)
    monkeypatch.setattr(export, "build", lambda: ImageSummary().eval())
    monkeypatch.setattr(sys, "argv", ["export.py", "--frontend", frontend])
    export.main()

    path = tmp_path / "cradio-v3b-dino-512-fp16.mlpackage"
    spec = ct.models.MLModel(str(path), skip_model_load=True).get_spec()
    assert spec.description.input[0].name == "image"
    assert spec.description.input[0].type.imageType.width == 512
    assert spec.description.input[0].type.imageType.height == 512
    assert spec.description.output[0].name == "embedding"
    assert list(spec.description.output[0].type.multiArrayType.shape) == [1, export.EMBEDDING_DIM]
    assert json.loads(path.with_suffix(".json").read_text())["frontend"] == frontend

    monkeypatch.setattr(sys, "argv", ["export.py", "--frontend", frontend, "--weights", "int8"])
    export.main()
    path = tmp_path / "cradio-v3b-dino-512-int8.mlpackage"
    compressed = ct.models.MLModel(str(path), skip_model_load=True)
    weights = [op for op in export.mil_program(compressed).functions["main"].operations
               if op.op_type == "constexpr_affine_dequantize"]
    assert len(weights) == 1
    state = torch.load(tmp_path / "fakequant_state.pt", weights_only=True)
    np.testing.assert_array_equal(weights[0].materialized_val_inference(), state["radio.weight"].numpy())


class LinearSummary(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.radio = torch.nn.Linear(128, 64)

    def forward(self, x):
        return self.radio(x)


def test_fakequant_checkpoint_matches_the_compressed_coreml_weights(tmp_path, monkeypatch):
    monkeypatch.setattr(export, "ARTIFACTS", tmp_path)
    torch.manual_seed(3)
    model = LinearSummary().eval()
    example = torch.randn(1, 128)
    converted = ct.convert(
        torch.jit.trace(model, example),
        inputs=[ct.TensorType(name="input", shape=(1, 128))],
        outputs=[ct.TensorType(name="output", dtype=np.float32)],
        minimum_deployment_target=ct.target.iOS17,
        compute_precision=ct.precision.FLOAT16,
        skip_model_load=True,
    )
    compressed = export.quantize(converted, model, "int8", 512)
    state = torch.load(tmp_path / "fakequant_state.pt", weights_only=True)
    assert not torch.equal(state["radio.weight"], model.radio.weight)
    ops = [op for op in export.mil_program(compressed).functions["main"].operations
           if op.op_type == "constexpr_affine_dequantize"]
    assert len(ops) == 1
    np.testing.assert_array_equal(ops[0].materialized_val_inference(), state["radio.weight"].numpy())
    assert int(ops[0].axis.val) == 0
    assert ops[0].quantized_data.val.dtype == np.int8
    assert np.all(ops[0].zero_point.val == 0)
    # The second resolution must reuse exactly the same checkpoint.
    export.quantize(converted, model, "int8", 448)
