"""C-RADIOv3-B with the phone's numerics: the pinned RADIO checkpoint with the CoreML
export's dequantized int8 Linear weights loaded over it (decision 001), run in the
compute dtype the drift check accepted. Every module takes its device from settings."""

import hashlib
import logging
from pathlib import Path

import numpy as np
import torch

from .config import get_settings
from .model_version import EMBEDDING_DIM, REPO_ROOT

log = logging.getLogger(__name__)

RADIO_REVISION = "c0f37017930e9dda53f93424cf4bf39fc51f287e"
RADIO_VERSION = "c-radio_v3-b"
CHECKPOINT_NAME = "c-radio_v3-b_half.pth.tar"
CHECKPOINT_SHA256 = "530b0e827b1d409ca3b175466e11062885baedd823ec5dae3a88348e76d4c398"
DEFAULT_FAKEQUANT = REPO_ROOT / "spikes" / "coreml-export" / "artifacts" / "fakequant_state.pt"
DTYPES = {"float16": torch.float16, "float32": torch.float32}


class NonFiniteEmbedding(RuntimeError):
    pass


class DinoSummary(torch.nn.Module):
    def __init__(self, radio: torch.nn.Module):
        super().__init__()
        self.radio = radio

    def forward(self, image: torch.Tensor) -> torch.Tensor:
        return self.radio(image)["dino_v2"].summary


def sha256_of(path: Path) -> str:
    with Path(path).open("rb") as body:
        return hashlib.file_digest(body, "sha256").hexdigest()


def build_radio() -> DinoSummary:
    radio = torch.hub.load(
        f"NVlabs/RADIO:{RADIO_REVISION}",
        "radio_model",
        version=RADIO_VERSION,
        adaptor_names=["dino_v2"],
        trust_repo=True,
        skip_validation=True,
    )
    checkpoint = Path(torch.hub.get_dir()) / "checkpoints" / CHECKPOINT_NAME
    if sha256_of(checkpoint) != CHECKPOINT_SHA256:
        raise RuntimeError("Upstream RADIO checkpoint changed; do not reuse this model version")
    return DinoSummary(radio).float().eval()


def apply_fakequant(model: torch.nn.Module, state: dict[str, torch.Tensor]) -> None:
    """Load the export's round-tripped state over the model; every tensor must land."""
    missing, unexpected = model.load_state_dict(state, strict=False)
    if unexpected:
        raise ValueError(f"fakequant state has tensors the model lacks: {sorted(unexpected)[:5]}")
    if missing:
        raise ValueError(f"fakequant state misses model tensors: {sorted(missing)[:5]}")


class Embedder:
    """`embed(batch)` maps `[B, 3, S, S]` RGB (uint8, or float in 0..1) to L2-normalized
    float32 `[B, EMBEDDING_DIM]` vectors."""

    def __init__(self, model: torch.nn.Module, device: str, dtype: torch.dtype):
        self.model = model.to(device=device, dtype=dtype).eval()
        self.device = device
        self.dtype = dtype
        conditioner = getattr(getattr(model, "radio", None), "input_conditioner", None)
        if conditioner is not None:
            # Module.to() does not update RADIO's ordinary Python dtype attribute.
            conditioner.dtype = dtype

    @property
    def dtype_name(self) -> str:
        return str(self.dtype).removeprefix("torch.")

    def embed(self, batch: torch.Tensor) -> np.ndarray:
        if batch.ndim != 4 or batch.shape[1] != 3:
            raise ValueError("embed expects a [B, 3, S, S] batch")
        with torch.inference_mode():
            pixels = batch.to(self.device)
            if pixels.dtype == torch.uint8:
                pixels = pixels.to(self.dtype) / 255
            else:
                pixels = pixels.to(self.dtype)
            output = self.model(pixels).float().cpu().numpy()
        if output.shape != (batch.shape[0], EMBEDDING_DIM):
            raise ValueError(f"model returned {output.shape}, expected (B, {EMBEDDING_DIM})")
        if not np.isfinite(output).all():
            raise NonFiniteEmbedding(f"non-finite embedding on {self.device}/{self.dtype_name}")
        norms = np.linalg.norm(output, axis=1, keepdims=True)
        if (norms == 0).any():
            raise NonFiniteEmbedding("zero-norm embedding")
        return (output / norms).astype(np.float32)


def load_embedder(
    fakequant_path: Path = DEFAULT_FAKEQUANT,
    *,
    device: str | None = None,
    dtype: str = "float16",
) -> Embedder:
    if dtype not in DTYPES:
        raise ValueError(f"dtype must be one of {sorted(DTYPES)}")
    fakequant_path = Path(fakequant_path)
    if not fakequant_path.exists():
        raise FileNotFoundError(
            f"{fakequant_path} is missing; reproduce it with the spike export "
            "(spikes/coreml-export/README.md) before building an index"
        )
    device = device or get_settings().device
    model = build_radio()
    apply_fakequant(model, torch.load(fakequant_path, weights_only=True, map_location="cpu"))
    log.info("embedder ready on %s/%s from %s", device, dtype, fakequant_path.name)
    return Embedder(model, device, DTYPES[dtype])
