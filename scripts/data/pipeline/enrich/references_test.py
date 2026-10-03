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


def test_accepts_a_caption_copied_without_its_punctuation_or_markdown():
    caption = {**SOURCE, "text": "Vincent van Gogh. _The Starry Night_. Saint Rémy, June 1889"}
    row = {
        **ROW,
        "evidence": "Vincent van Gogh. The Starry Night\nSaint Rémy, June 1889",
        "conflicts": [{"field": "date", "text": "June, 1889"}],
    }
    sources, conflicts = review_references(
        Mock(chat=Mock(return_value={"reviews": [row]})), [caption], {}
    )
    assert sources == [caption]
    assert conflicts[0]["text"] == "June, 1889"


@pytest.mark.parametrize(
    ("text", "evidence", "field", "conflict_text"),
    [
        ("この星月夜の制作年は1889年です。", "星月夜", "date", "1889年"),
        ("这幅神奈川冲浪里由葛饰北斋创作。", "神奈川冲浪里", "artist", "葛饰北斋"),
        (
            "このひまわりの作者はフィンセントファンゴッホです。",
            "ひまわり",
            "artist",
            "フィンセントファンゴッホ",
        ),
        ("この富士山の作者は𠮷田博です。", "富士山", "artist", "𠮷田博"),
    ],
)
def test_accepts_exact_excerpts_within_unspaced_prose(text, evidence, field, conflict_text):
    caption = {**SOURCE, "text": text}
    conflict = {"field": field, "text": conflict_text}
    row = {**ROW, "evidence": evidence, "conflicts": [conflict]}
    sources, conflicts = review_references(
        Mock(chat=Mock(return_value={"reviews": [row]})), [caption], {}
    )
    assert sources == [caption]
    assert conflicts == [
        {
            **conflict,
            "sourceUrl": caption["url"],
            "sourceLabel": caption["label"],
            "referenceUrl": caption["referenceUrl"],
        }
    ]


@pytest.mark.parametrize(
    ("text", "evidence"),
    [
        ("作者はFollower of Pieter Brueghel IIです。", "ollower of Pieter Brueghel II"),
        ("作者はFollower of Pieter Brueghel IIです。", "Follower of Pieter Brueg"),
        ("制作年は1889年です。", "889年"),
        ("この星月夜の制作年は1889年です。", "月星夜"),
    ],
)
def test_rejects_partial_words_numbers_and_reordered_characters_in_unspaced_prose(text, evidence):
    row = {**ROW, "evidence": evidence, "conflicts": []}
    with pytest.raises(ValueError, match="Invalid reference review"):
        review_references(
            Mock(chat=Mock(return_value={"reviews": [row]})), [{**SOURCE, "text": text}], {}
        )


@pytest.mark.parametrize(
    "rows",
    [
        [],
        [ROW, ROW],
        [{**ROW, "evidence": "Invented passage"}],
        [{**ROW, "evidence": "ollower of Pieter Brueg"}],
        [{**ROW, "conflicts": [{"field": "date", "text": "Made in 1612"}]}],
    ],
)
def test_invalid_reviews_fail_closed(rows):
    with pytest.raises(ValueError):
        review_references(Mock(chat=Mock(return_value={"reviews": rows})), [SOURCE], {})
