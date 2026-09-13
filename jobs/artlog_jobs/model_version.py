import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
MODEL_VERSION_PATH = REPO_ROOT / "shared" / "model" / "model-version.json"

_model = json.loads(MODEL_VERSION_PATH.read_text())

MODEL_VERSION: str = _model["modelVersion"]
EMBEDDING_DIM: int = _model["embeddingDim"]
INPUT_SIZE: int = _model["inputSize"]
ORB_MAX_KEYPOINTS: int = _model["orbMaxKeypoints"]
