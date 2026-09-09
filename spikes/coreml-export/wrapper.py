from pathlib import Path
from hashlib import file_digest

import torch

RADIO_REVISION = "c0f37017930e9dda53f93424cf4bf39fc51f287e"
ARTIFACTS = Path(__file__).resolve().parent / "artifacts"
EMBEDDING_DIM = 1536
CHECKPOINT_SHA256 = "530b0e827b1d409ca3b175466e11062885baedd823ec5dae3a88348e76d4c398"


class DinoSummary(torch.nn.Module):
    def __init__(self, radio):
        super().__init__()
        self.radio = radio

    def forward(self, image):
        return self.radio(image)["dino_v2"].summary


def build():
    ARTIFACTS.mkdir(exist_ok=True)
    torch.hub.set_dir(str(ARTIFACTS / "torch-hub"))
    radio = torch.hub.load(
        f"NVlabs/RADIO:{RADIO_REVISION}",
        "radio_model",
        version="c-radio_v3-b",
        adaptor_names=["dino_v2"],
        trust_repo=True,
        skip_validation=True,
    )
    checkpoint = ARTIFACTS / "torch-hub/checkpoints/c-radio_v3-b_half.pth.tar"
    with checkpoint.open("rb") as file:
        if file_digest(file, "sha256").hexdigest() != CHECKPOINT_SHA256:
            raise RuntimeError("Upstream checkpoint changed; do not reuse this model version")
    return DinoSummary(radio).float().eval()
