import json

import coremltools as ct
import numpy as np
import pytest
import torch

import export_coreml


class ImageSummary(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.radio = torch.nn.Linear(3, export_coreml.EMBEDDING_DIM)

    def forward(self, image):
        return self.radio(image.mean(dim=(-2, -1)))


def dequantize_ops(model):
    return [op for op in export_coreml.mil_program(model).functions["main"].operations
            if op.op_type == "constexpr_affine_dequantize"]


def test_export_writes_the_package_checkpoint_and_manifest(tmp_path):
    manifest = export_coreml.export(tmp_path, build=lambda: ImageSummary().eval())

    package = tmp_path / "CRadioV3B.mlpackage"
    spec = ct.models.MLModel(str(package), skip_model_load=True).get_spec()
    image = spec.description.input[0]
    assert image.name == "image"
    assert (image.type.imageType.width, image.type.imageType.height) == (512, 512)
    assert spec.description.output[0].name == "embedding"
    assert list(spec.description.output[0].type.multiArrayType.shape) == [1, 1536]

    state = torch.load(tmp_path / "fakequant_state.pt", weights_only=True)
    ops = dequantize_ops(ct.models.MLModel(str(package), skip_model_load=True))
    assert len(ops) == 1
    np.testing.assert_array_equal(ops[0].materialized_val_inference(), state["radio.weight"].numpy())

    shared = json.loads((export_coreml.REPO_ROOT / "shared" / "model-version.json").read_text())
    written = json.loads((tmp_path / "model-manifest.json").read_text())
    assert written == manifest
    assert (manifest["modelVersion"], manifest["inputSize"], manifest["embeddingDim"]) == (
        shared["modelVersion"], shared["inputSize"], shared["embeddingDim"])
    assert manifest["quantizedWeights"] == 1
    assert manifest["normalizedOutput"] is False
    assert manifest["mlpackageSha256"] == export_coreml.directory_sha256(package)
    assert len(manifest["weightsSha256"]) == 64


def test_export_refuses_a_recipe_that_disagrees_with_the_shared_model_version(tmp_path, monkeypatch):
    monkeypatch.setattr(export_coreml, "MODEL_VERSION", "c-radiov3-b-int8-512-dinov2-v2")
    with pytest.raises(RuntimeError, match="shared/model-version.json"):
        export_coreml.export(tmp_path, build=lambda: ImageSummary().eval())
    assert not (tmp_path / "CRadioV3B.mlpackage").exists()


class LinearSummary(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.radio = torch.nn.Linear(128, 64)

    def forward(self, x):
        return self.radio(x)


def test_quantize_stores_signed_int8_per_output_channel_and_recovers_coreml_weights():
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
    compressed, state, quantized = export_coreml.quantize(converted, model)
    assert quantized == ["radio.weight"]
    assert not torch.equal(state["radio.weight"], model.radio.weight)
    torch.testing.assert_close(state["radio.bias"], model.radio.bias.detach().half().float())
    ops = dequantize_ops(compressed)
    assert len(ops) == 1
    np.testing.assert_array_equal(ops[0].materialized_val_inference(), state["radio.weight"].numpy())
    assert int(ops[0].axis.val) == 0
    assert ops[0].quantized_data.val.dtype == np.int8
    assert np.all(ops[0].zero_point.val == 0)
