from .multiplicity import apply_multiplicity
from .normalize import ArtworkRecord


def artwork(qid, title="Sunset", artist="Ada Painter", **fields):
    return ArtworkRecord(
        key=f"wikidata:{qid}",
        wikidataId=qid,
        title=title,
        artist=artist,
        rightsStatus="unknown",
        **fields,
    )


def test_normalized_artist_and_title_duplicates_are_multiple():
    rows = [artwork("Q1"), artwork("Q2", title=" SUNSET! ", artist="Ａda  Painter")]
    assert {
        row.multiplicity for row in apply_multiplicity(rows, version_items=set(), complete=True)
    } == {"multiple"}


def test_series_versions_and_unknown_artist_do_not_claim_uniqueness():
    rows = [
        artwork("Q1", seriesId="wikidata:Q100"),
        artwork("Q2", title="Version"),
        artwork("Q3", artist="Unknown artist"),
        artwork("Q4", title="Unique"),
    ]
    result = apply_multiplicity(rows, version_items={"Q2"}, complete=True)
    assert [row.multiplicity for row in result] == ["unknown", "unknown", "unknown", "unique"]
    assert result[0].seriesId == "wikidata:Q100"


def test_partial_corpus_and_museum_only_rows_remain_unknown():
    museum = ArtworkRecord(key="met:1", title="Work", artist="Artist", rightsStatus="public_domain")
    result = apply_multiplicity([museum, artwork("Q1")], version_items=set(), complete=False)
    assert all(row.multiplicity == "unknown" for row in result)
