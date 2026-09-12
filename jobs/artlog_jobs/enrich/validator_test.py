import json

import pytest

from artlog_jobs.enrich.validator import validate
from artlog_jobs.model_version import REPO_ROOT

FIXTURE = json.loads((REPO_ROOT / "shared/fixtures/docent-validator.json").read_text())


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda c: c["name"])
def test_shared_validator_contract(case):
    assert validate(case["sentences"], set(case["factIds"])) == case["expectedKept"]
