import pytest

from .onview import Imported, iter_records, read_snapshot, write_snapshot


def row(id, **fields):
    return {"id": id, "accession": f"A{id}", "url": f"https://museum.example/{id}"} | fields


def test_snapshot_round_trips_and_refuses_a_thin_or_repeating_listing(tmp_path):
    rows = [row("1", onView=True, gallery="Room 1"), row("2", onView=False)]
    stats = write_snapshot(tmp_path / "museum", rows, minimum_on_view=1)
    assert stats["onView"] == 1
    assert read_snapshot(tmp_path / "museum") == (stats, rows)
    with pytest.raises(RuntimeError, match="only 1 works on view"):
        write_snapshot(tmp_path / "thin", rows, minimum_on_view=2)
    with pytest.raises(RuntimeError, match="repeated"):
        write_snapshot(tmp_path / "repeat", rows + rows[:1], minimum_on_view=1)


def imported(key, owner="wikidata:Q1", accession=None, **fields):
    return {
        "key": key,
        "artworkKey": f"art:{key}",
        "ownerKey": owner,
        "accession": accession,
        **fields,
    }


def test_rows_name_one_imported_object_by_wikidata_item_or_by_owner_and_number():
    objects = Imported(
        [
            imported("met:1", accession="A1"),
            # An imported alias stands for its survivor.
            imported("wikidata:Q10", accession="A1", mergedIntoKey="met:1"),
            imported("wikidata:Q20", accession="A2"),
            imported("wikidata:Q21", accession="A2"),
            imported("wikidata:Q30", owner="wikidata:Q2", accession="A3"),
            imported("wikidata:Q40", owner=None, accession="A4"),
        ]
    )
    target = objects.target
    assert target("wikidata:Q1", row("1", accession=" a1 "))["key"] == "met:1"
    assert target("wikidata:Q1", row("2", wikidataId="Q10"))["key"] == "met:1"
    # A number two imported objects share names neither.
    assert target("wikidata:Q1", row("3", accession="A2")) is None
    assert target("wikidata:Q1", row("4", accession="A3")) is None
    assert target("wikidata:Q1", row("5", wikidataId="Q30")) is None
    assert target("wikidata:Q1", row("6", wikidataId="Q40")) is None


def test_matched_rows_become_image_free_aliases_of_the_imported_object():
    triples = list(
        iter_records(
            "museum",
            "wikidata:Q1",
            [
                row("1", title="Harbor", onView=True, gallery="Room 1"),
                row("2", wikidataId="Q20", accession=None, onView=False, gallery="Not on display"),
                row("3", onView=True),
            ],
            Imported([imported("wikidata:Q10", accession="A1"), imported("wikidata:Q20")]),
        )
    )
    assert [obj.key for _, obj, _ in triples] == ["museum:1", "museum:2"]
    artwork, obj, placement = triples[0]
    assert artwork.key == obj.artworkKey == "art:wikidata:Q10"
    assert (obj.ownerKey, obj.accession, obj.aliasOf, obj.imageRef, obj.thumbnailUrl) == (
        "wikidata:Q1",
        "A1",
        "wikidata:Q10",
        None,
        None,
    )
    assert (placement.venueKey, placement.gallery, placement.onView) == (
        "wikidata:Q1",
        "Room 1",
        True,
    )
    assert (triples[1][1].aliasOf, triples[1][1].accession, triples[1][2].gallery) == (
        "wikidata:Q20",
        None,
        None,
    )
