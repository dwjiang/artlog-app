import json

from pipeline import model_version


def test_constants_come_from_the_shared_json():
    shared = json.loads(model_version.MODEL_VERSION_PATH.read_text())
    assert model_version.MODEL_VERSION_PATH.parts[-3:] == ("shared", "model", "model-version.json")
    assert model_version.MODEL_VERSION == shared["modelVersion"]
    assert model_version.EMBEDDING_DIM == shared["embeddingDim"] == 512
    assert model_version.INPUT_SIZE == shared["inputSize"] == 512
    assert model_version.ORB_MAX_KEYPOINTS == shared["orbMaxKeypoints"] == 500
