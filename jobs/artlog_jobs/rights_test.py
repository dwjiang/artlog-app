import pytest

from .rights import from_copyright_notice, from_source_flag, from_wikidata, merge_rights


@pytest.mark.parametrize(
    ("flag", "expected"),
    [(True, "public_domain"), (False, "unknown"), (None, "unknown"), ("True", "unknown")],
)
def test_only_boolean_source_flags_establish_public_domain(flag, expected):
    assert from_source_flag(flag) == expected


@pytest.mark.parametrize(
    "notice",
    [
        None,
        "",
        "Public domain",
        "No known copyright restrictions",
        "Copyright status undetermined",
        "May be subject to copyright",
    ],
)
def test_ambiguous_notice_is_unknown(notice):
    assert from_copyright_notice(notice) == "unknown"


@pytest.mark.parametrize(
    "notice",
    ["© 2026 Artist Estate", "Copyright 1998 Jane Smith", "All rights reserved", "(c) Artist"],
)
def test_explicit_copyright_notice(notice):
    assert from_copyright_notice(notice) == "in_copyright"


@pytest.mark.parametrize(
    ("statuses", "deaths", "expected"),
    [
        (["Q19652"], [], "public_domain"),
        ([], [1926], "public_domain"),
        ([], [1927], "unknown"),
        ([], [1956], "unknown"),
        ([], [1957], "in_copyright"),
        ([], [], "unknown"),
        ([], [1900, None], "unknown"),
        ([], [1900, 1980], "in_copyright"),
        ([], [2030], "unknown"),
        (["Q50423863"], [1800], "in_copyright"),
        (["Q19652", "Q50423863"], [1800], "in_copyright"),
        (["Q99999"], [1800], "unknown"),
    ],
)
def test_wikidata_conservative_evidence_and_year_boundaries(statuses, deaths, expected):
    assert from_wikidata(statuses, deaths, current_year=2026) == expected


def test_merge_never_weakens_unknown_or_copyright_evidence():
    assert merge_rights(["public_domain", "unknown"]) == "unknown"
    assert merge_rights(["public_domain", "in_copyright"]) == "in_copyright"
    assert merge_rights(["public_domain", "public_domain"]) == "public_domain"


def test_explicit_copyright_is_retained_when_the_notice_also_mentions_permission():
    assert from_copyright_notice("© 2020 Jane Smith. Used with permission.") == "in_copyright"
