import pytest

from .normalize import ArtworkRecord, ObjectRecord, merge_records, qid, year


def triple(source, rights="public_domain", **fields):
    key = f"{source}:1"
    return (
        ArtworkRecord(
            key=key, wikidataId="Q1", title=source, artist="Painter", rightsStatus=rights, **fields
        ),
        ObjectRecord(
            key=key,
            artworkKey=key,
            sourceId="1",
            pageUrl="https://example.org/1",
            thumbnailUrl="https://example.org/thumb.jpg",
        ),
        None,
    )


def test_merge_uses_wikidata_fields_keeps_every_object_and_rekeys_references():
    met = triple("met", date="1900", yearStart=1900)
    wd = triple("wikidata")
    aic = triple("aic")
    artworks, objects, placements = merge_records([met, wd, aic])
    assert len(artworks) == 1
    assert artworks[0].title == "wikidata"
    assert artworks[0].date == "1900"
    assert artworks[0].key == "wikidata:Q1"
    assert [obj.key for obj in objects] == ["aic:1", "met:1", "wikidata:1"]
    assert {obj.artworkKey for obj in objects} == {"wikidata:Q1"}
    assert placements == []


def test_merge_is_order_independent_and_clears_thumbnails_on_rights_conflict():
    records = [triple("met"), triple("wikidata", "unknown")]
    assert merge_records(records) == merge_records(reversed(records))
    artworks, objects, _ = merge_records(records)
    assert artworks[0].rightsStatus == "unknown"
    assert all(obj.thumbnailUrl is None for obj in objects)


def test_repeated_input_is_idempotent_but_conflicting_object_keys_fail():
    row = triple("met")
    assert len(merge_records([row, row])[1]) == 1
    changed = (row[0], row[1].model_copy(update={"accession": "different"}), None)
    with pytest.raises(ValueError, match="Conflicting object"):
        merge_records([row, changed])


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("https://www.wikidata.org/wiki/Q123", "Q123"),
        ("http://www.wikidata.org/entity/Q123", "Q123"),
        ("Q123", "Q123"),
        ("https://example.org/Q123", None),
        ("Q0", None),
        ("", None),
    ],
)
def test_wikidata_ids_are_real_entity_identifiers(value, expected):
    assert qid(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [("1900", 1900), ("-0300-01-01T00:00:00Z", -300), ("ca. 1900", None), ("", None)],
)
def test_year_parsing_preserves_bce_and_does_not_guess_dates(value, expected):
    assert year(value) == expected


def test_merge_rejects_mismatched_artwork_and_object_references():
    row = triple("met")
    with pytest.raises(ValueError, match="reference"):
        merge_records([(row[0], row[1].model_copy(update={"artworkKey": "met:2"}), None)])


def test_merge_rejects_conflicting_artwork_metadata_from_the_same_source_key():
    row = triple("met")
    changed = (row[0].model_copy(update={"title": "Different title"}), row[1], None)
    with pytest.raises(ValueError, match="Conflicting artwork"):
        merge_records([row, changed])


def test_missing_wikidata_labels_do_not_erase_known_museum_metadata():
    museum = triple("met")
    wd = triple("wikidata")
    wd = (wd[0].model_copy(update={"title": "Q1", "artist": "Unknown artist"}), wd[1], None)
    result = merge_records([museum, wd])[0][0]
    assert result.title == "met" and result.artist == "Painter"
