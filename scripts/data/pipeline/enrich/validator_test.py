import json

import pytest

from pipeline.enrich.validator import source_passage, validate
from pipeline.model_version import REPO_ROOT

FIXTURE = json.loads((REPO_ROOT / "shared/docent/fixtures/docent-validator.json").read_text())


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda c: c["name"])
def test_shared_validator_contract(case):
    assert validate(case["sentences"], set(case["factIds"])) == case["expectedKept"]


def test_reads_a_copy_the_same_whatever_its_typography():
    assert source_passage("Musée de l’Orangerie") == source_passage("Musee de l'Orangerie")
    assert (
        source_passage("Hammershøi’s Straße, Læsø, Łódź, 73 × 93 cm")
        == "hammershois strasse, laeso, lodz, 73 x 93 cm"
    )
    assert source_passage("in 1888–89, near‑abstract") == source_passage(
        "in 1888-89, near-abstract"
    )
    assert (
        source_passage("«Monet´s» „garden“ ‹pond› sea\u00adscape") == "monets garden pond seascape"
    )
