from unittest.mock import Mock

import pytest

from .references import (
    bounded_references,
    commons_references,
    review_references,
    wikidata_references,
)

SOURCE = {
    "url": "https://auction.example/1",
    "referenceUrl": "https://www.wikidata.org/wiki/Q1",
    "label": "Auction",
    "score": 0.8,
    "text": "Carnival and Lent. Follower of Pieter Brueghel II. Oil on circular panel.",
}
ROW = {
    "source": "s1",
    "comparison": "The citation and object details match the target.",
    "relation": "same_artwork",
    "evidence": SOURCE["text"],
    "conflicts": [{"field": "artist", "text": "Follower of Pieter Brueghel II."}],
}


def test_bounded_public_references():
    urls = [
        "http://museum.org/a",
        "https://127.0.0.1/a",
        "https://a.internal/a",
        "https://user:pw@a.org/a",
        "https://a.org:444/a",
        "https://a.org/a#one",
        "https://www.a.org/a?utm_source=x",
    ] + [f"https://new-publisher.org/{i}" for i in range(9)]
    result = bounded_references(
        [{"url": url, "referenceUrl": SOURCE["referenceUrl"]} for url in urls]
    )
    assert [r["url"] for r in result] == ["https://a.org/a"] + [
        f"https://new-publisher.org/{i}" for i in range(4)
    ]


def test_only_citation_cells_and_statement_references():
    assert commons_references(
        '<a href="https://unrelated.org">Home</a><table><tr><td id="fileinfotpl&#95;art&#95;references">References</td><td><a href="https://auction.example/1">Lot</a></td></tr></table>',
        SOURCE["referenceUrl"],
    ) == [{k: SOURCE[k] for k in ("url", "referenceUrl")}]
    assert wikidata_references(
        {
            "id": "Q1",
            "claims": {
                "P170": [
                    {"references": [{"snaks": {"P854": [{"datavalue": {"value": SOURCE["url"]}}]}}]}
                ]
            },
        }
    ) == [{k: SOURCE[k] for k in ("url", "referenceUrl")}]


def test_preserves_conflicts_and_rejects_other_works():
    provider = Mock()
    provider.chat.return_value = {"reviews": [ROW]}
    sources, conflicts = review_references(
        provider, [SOURCE], {"title": "Carnival and Lent", "artist": "Marten van Cleve"}
    )
    assert sources == [SOURCE]
    assert conflicts[0]["field"] == "artist"
    assert conflicts[0]["referenceUrl"] == SOURCE["referenceUrl"]
    provider.chat.return_value = {"reviews": [{**ROW, "relation": "other", "conflicts": []}]}
    assert review_references(provider, [SOURCE], {}) == ([], [])


@pytest.mark.parametrize(
    "rows",
    [
        [],
        [ROW, ROW],
        [{**ROW, "evidence": "Invented passage"}],
        [{**ROW, "conflicts": [{"field": "date", "text": "Made in 1612"}]}],
    ],
)
def test_invalid_reviews_fail_closed(rows):
    with pytest.raises(ValueError):
        review_references(Mock(chat=Mock(return_value={"reviews": rows})), [SOURCE], {})
