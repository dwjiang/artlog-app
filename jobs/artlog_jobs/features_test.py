import json

import numpy as np
import pytest

from artlog_jobs.features import Features


@pytest.mark.parametrize(
    "corruption",
    ["version", "drift", "dimension", "nan", "norm", "offset", "truncated", "duplicate"],
)
def test_rejects_invalid_features_before_they_can_be_pushed(merged_corpus, corruption):
    directory = merged_corpus()
    manifest_path = directory / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    if corruption == "version":
        manifest["modelVersion"] = "other-version"
    elif corruption == "drift":
        manifest["driftCheck"]["min"] = 0.96
    elif corruption in {"dimension", "nan", "norm"}:
        path = directory / "vectors-0.npy"
        matrix = np.load(path)
        if corruption == "dimension":
            matrix = matrix[:, :-1]
        else:
            matrix[0, 0] = np.nan if corruption == "nan" else 2
        np.save(path, matrix)
    elif corruption == "offset":
        path = directory / "descriptors-0.json"
        index = json.loads(path.read_text())
        index[0]["offset"] = 1
        path.write_text(json.dumps(index))
    elif corruption == "truncated":
        path = directory / "descriptors-0.bin"
        path.write_bytes(path.read_bytes()[:-1])
    else:
        path = directory / "keys-0.json"
        keys = json.loads(path.read_text())
        keys[1] = keys[0]
        path.write_text(json.dumps(keys))
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError):
        Features(directory)
