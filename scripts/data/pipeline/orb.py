"""ORB features in the wire format defined in `shared/orb/features.ts`:
descriptors are `count×32` bytes; keypoints are `count×4` little-endian float32
`[x, y, size, angle]` in letterboxed pixel space; `count ≤ 1000`."""

import base64
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from .letterbox import letterbox
from .model_version import INPUT_SIZE, ORB_MAX_KEYPOINTS

DESCRIPTOR_BYTES = 32
KEYPOINT_BYTES = 16
MAX_KEYPOINTS = 1000
KEYPOINT_DTYPE = np.dtype("<f4")


@dataclass(frozen=True)
class OrbFeatures:
    descriptors: bytes
    keypoints: bytes
    count: int

    def descriptor_array(self) -> np.ndarray:
        return np.frombuffer(self.descriptors, dtype=np.uint8).reshape(self.count, DESCRIPTOR_BYTES)

    def keypoint_array(self) -> np.ndarray:
        return np.frombuffer(self.keypoints, dtype=KEYPOINT_DTYPE).reshape(self.count, 4)


def to_gray(img: Image.Image) -> np.ndarray:
    return np.asarray(img.convert("L"), dtype=np.uint8)


def extract_orb(gray: np.ndarray, nfeatures: int = ORB_MAX_KEYPOINTS) -> OrbFeatures:
    if gray.ndim != 2 or gray.dtype != np.uint8:
        raise ValueError("extract_orb expects a 2-D uint8 grayscale image")
    if gray.shape[0] != gray.shape[1]:
        raise ValueError("extract_orb expects the letterboxed square input")
    if not 1 <= nfeatures <= MAX_KEYPOINTS:
        raise ValueError(f"nfeatures must be within 1..{MAX_KEYPOINTS}")
    orb = cv2.ORB_create(nfeatures=nfeatures)
    keypoints, descriptors = orb.detectAndCompute(gray, None)
    if descriptors is None or len(keypoints) == 0:
        return OrbFeatures(b"", b"", 0)
    # retainBest keeps ties past nfeatures; truncating preserves OpenCV's output order.
    keypoints = keypoints[:nfeatures]
    descriptors = descriptors[:nfeatures]
    packed = np.array(
        [[k.pt[0], k.pt[1], k.size, k.angle] for k in keypoints], dtype=KEYPOINT_DTYPE
    )
    return OrbFeatures(descriptors.astype(np.uint8).tobytes(), packed.tobytes(), len(keypoints))


def extract_from_image(img: Image.Image, size: int = INPUT_SIZE) -> OrbFeatures:
    return extract_orb(to_gray(letterbox(img, size)))


def to_fixture(features: OrbFeatures, input_size: int) -> dict:
    return {
        "count": features.count,
        "inputSize": input_size,
        "descriptorsBase64": base64.b64encode(features.descriptors).decode("ascii"),
        "keypointsBase64": base64.b64encode(features.keypoints).decode("ascii"),
    }


def from_fixture(fixture: dict) -> OrbFeatures:
    descriptors = base64.b64decode(fixture["descriptorsBase64"])
    keypoints = base64.b64decode(fixture["keypointsBase64"])
    count = int(fixture["count"])
    if len(descriptors) != count * DESCRIPTOR_BYTES or len(keypoints) != count * KEYPOINT_BYTES:
        raise ValueError("fixture byte lengths do not match count")
    return OrbFeatures(descriptors, keypoints, count)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: python -m pipeline.orb <image> <fixture.json>", file=sys.stderr)
        return 2
    image, out = Path(argv[0]), Path(argv[1])
    features = extract_from_image(Image.open(image))
    out.write_text(json.dumps(to_fixture(features, INPUT_SIZE), indent=2) + "\n")
    print(f"wrote {out} count={features.count}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
