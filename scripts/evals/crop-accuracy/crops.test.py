import base64

import cv2
import numpy as np

from crops import MODEL, orb


def test_featureless_crop_encodes_an_unverified_match(tmp_path):
    path = tmp_path / "blank.png"
    cv2.imwrite(str(path), np.full((512, 512, 3), 128, dtype=np.uint8))
    assert orb(path) == {"descriptors": "", "keypoints": ""}


def test_color_crop_uses_native_grayscale_features(tmp_path):
    # Colored noise makes PNG decoder rounding observable in the descriptors.
    image = np.random.default_rng(42).integers(0, 256, (512, 512, 3), dtype=np.uint8)
    path = tmp_path / "color.png"
    cv2.imwrite(str(path), image)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    points, descriptors = cv2.ORB_create(nfeatures=MODEL["orbMaxKeypoints"]).detectAndCompute(gray, None)
    points = points[: MODEL["orbMaxKeypoints"]]
    descriptors = descriptors[: MODEL["orbMaxKeypoints"]]
    packed = np.array([[p.pt[0], p.pt[1], p.size, p.angle] for p in points], dtype="<f4").tobytes()
    assert orb(path) == {
        "descriptors": base64.b64encode(descriptors.tobytes()).decode(),
        "keypoints": base64.b64encode(packed).decode(),
    }
