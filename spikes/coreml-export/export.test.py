import coremltools as ct
import numpy as np
import torch

import export


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
