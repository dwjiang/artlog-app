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
def test_leaves_out_a_reference_quoted_with_partial_words_numbers_or_reordered_characters(
    text, evidence
):
    row = {**ROW, "evidence": evidence, "conflicts": []}
    assert review_references(
        Mock(chat=Mock(return_value={"reviews": [row]})), [{**SOURCE, "text": text}], {}
    ) == ([], [])


@pytest.mark.parametrize(
    "value",
    [
        None,
        {"reviews": []},
        {"reviews": [{**ROW, "evidence": "Invented passage"}]},
        {"reviews": [{**ROW, "evidence": "ollower of Pieter Brueg"}]},
        {"reviews": [{**ROW, "conflicts": [{"field": "date", "text": "Made in 1612"}]}]},
        {
            "reviews": [
                {**ROW, "conflicts": [{"field": "title", "text": ROW["conflicts"][0]["text"]}]}
            ]
        },
    ],
)
def test_leaves_out_a_reference_whose_review_is_missing_or_ungrounded(value):
    assert review_references(Mock(chat=Mock(return_value=value)), [SOURCE], {}) == ([], [])


def test_an_unreadable_review_leaves_out_only_the_references():
    catalogue = {**SOURCE, "url": "https://museum.example/work", "referenceUrl": None}
    provider = Mock(chat=Mock(side_effect=ValueError("Invalid or truncated model JSON")))
    assert review_references(provider, [SOURCE, catalogue], {}) == ([catalogue], [])


def test_reads_each_row_on_its_own():
    second = {**SOURCE, "url": "https://auction.example/2", "text": "Another lot. Oil on panel."}
    rows = [
        {**ROW, "conflicts": []},
        {**ROW, "conflicts": []},
        {"source": "s2", "relation": "same_artwork", "evidence": "invented", "conflicts": []},
    ]
    provider = Mock(chat=Mock(return_value={"reviews": rows}))
    assert review_references(provider, [SOURCE, second], {}) == ([SOURCE], [])


def test_never_drops_the_museums_own_page_but_still_flags_its_attribution():
    owner = {**SOURCE, "url": "https://museum.example/work", "firstParty": True}
    uncertain = {**ROW, "relation": "uncertain", "conflicts": []}
    assert review_references(
        Mock(chat=Mock(return_value={"reviews": [uncertain]})), [owner], {}
    ) == ([owner], [])
    _, conflicts = review_references(Mock(chat=Mock(return_value={"reviews": [ROW]})), [owner], {})
    assert len(conflicts) == 1


AGREEING = [
    ("date", "Dated 1840", {"artist": "Baijnath", "yearStart": 1840, "yearEnd": 1840}),
    ("date", "ca. 1700–1710", {"artist": "Unknown artist", "yearStart": 1705, "yearEnd": 1705}),
    ("date", "c. 1695", {"artist": "Unknown artist", "yearStart": 1700, "yearEnd": 1700}),
    ("date", "18th century", {"artist": "Unknown artist", "date": "1765"}),
    ("date", "1898–03", {"artist": "Unknown artist", "yearStart": 1900, "yearEnd": 1900}),
    ("date", "1698–02", {"artist": "Unknown artist", "date": "1701"}),
    ("date", "1900", {"artist": "Unknown artist", "date": "1898–03"}),
    ("artist", "Unknown", {"artist": "Baijnath"}),
    ("artist", "Anonymous", {"artist": "Baijnath"}),
    ("artist", "Vincent van Gogh (1853–1890)", {"artist": "Vincent van Gogh"}),
]
DISAGREEING = [
    ("date", "1916", {"artist": "Pierre Bonnard", "yearStart": 1939, "yearEnd": 1939}),
    ("date", "1898–03", {"artist": "Unknown artist", "yearStart": 1820, "yearEnd": 1820}),
    ("date", "1698–02", {"artist": "Unknown artist", "date": "1620"}),
    ("date", "Edo period", {"artist": "Unknown artist", "yearStart": 1700, "yearEnd": 1700}),
    ("artist", "Follower of Pieter Brueghel II", {"artist": "Pieter Brueghel II"}),
]


@pytest.mark.parametrize(("field", "text", "target"), AGREEING + DISAGREEING)
def test_drops_only_conflicts_that_agree_with_the_work(field, text, target):
    page = {**SOURCE, "text": f"Object record. {text}. Oil on panel."}
    row = {**ROW, "evidence": "Object record", "conflicts": [{"field": field, "text": text}]}
    sources, conflicts = review_references(
        Mock(chat=Mock(return_value={"reviews": [row]})), [page], target
    )
    assert sources == [page]
    assert len(conflicts) == (0 if (field, text, target) in AGREEING else 1)


def test_review_reads_the_top_of_each_page_and_only_what_identifies_a_reference():
    provider = Mock(chat=Mock(return_value={"reviews": []}))
    catalogue = {
        "url": "https://museum.example/work",
        "label": "Museum",
        "score": 1,
        "text": "c" * 9000,
    }
    reference = {**SOURCE, "text": "r" * 9000}
    review_references(provider, [catalogue, reference], {"title": "Work", "artist": "Artist"})
    sent = provider.chat.call_args.kwargs["inputs"]
    assert sent["catalogue"] == [{"url": catalogue["url"], "text": "c" * 2500}]
    assert sent["references"] == [
        {
            "source": "s2",
            "url": SOURCE["url"],
            "label": SOURCE["label"],
            "referenceUrl": SOURCE["referenceUrl"],
            "text": "r" * 6000,
        }
    ]


def test_commons_references_skip_wiki_namespace_pages():
    html = (
        '<table><tr><td id="fileinfotpl_src">Source</td><td>'
        '<a href="https://www.wikidata.org/wiki/Property:P4610">Art Institute ID</a>'
        '<a href="https://commons.wikimedia.org/wiki/Category:Paintings">Paintings</a>'
        '<a href="https://www.artic.edu/artworks/27992">27992</a>'
        "</td></tr></table>"
    )
    assert commons_references(html, SOURCE["referenceUrl"]) == [
        {"url": "https://www.artic.edu/artworks/27992", "referenceUrl": SOURCE["referenceUrl"]}
    ]
