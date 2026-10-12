import json

import httpx
import pytest

from .wikidata_artworks import artwork_title, fetch_artworks


def binding(qid, **values):
    return {
        key: {"value": value}
        for key, value in {
            "item": f"http://www.wikidata.org/entity/{qid}",
            "cls": "http://www.wikidata.org/entity/Q3305213",
            **values,
        }.items()
    }


def test_painting_fetch_covers_collections_and_remainder_and_resumes(tmp_path):
    calls = []

    def fetch(query, **kwargs):
        calls.append(query)
        if "SELECT DISTINCT" in query:
            return [binding("Q1", collection="http://www.wikidata.org/entity/Q10"), binding("Q2")]
        return [binding("Q1" if "wd:Q1 " in query else "Q2", image="file.jpg")]

    first = fetch_artworks(tmp_path, user_agent="test", fetch=fetch)
    second = fetch_artworks(tmp_path, user_agent="test", fetch=fetch)
    assert first == second
    assert first["complete"] and first["items"] == 2
    # A census of paintings and one of other flat works, then one metadata query per slice.
    assert len(calls) == 4
    assert any("remainder" in path for path in first["files"])


def test_existing_painting_census_does_not_hide_flat_works(tmp_path):
    from .wikidata_artworks import census_queries, metadata_query

    painting = binding("Q1", image="painting.jpg")
    print_ = binding("Q2", cls="http://www.wikidata.org/entity/Q11060274", image="print.jpg")
    (tmp_path / "census.json").write_text(json.dumps([painting]))
    painting_query, flat_query = census_queries(2026)
    calls = []

    def fetch(query, **kwargs):
        calls.append(query)
        if query == painting_query:
            return [painting]
        if query == flat_query:
            return [print_]
        assert query == metadata_query(["Q1", "Q2"])
        return [painting, print_]

    result = fetch_artworks(tmp_path, user_agent="test", fetch=fetch, current_year=2026)

    assert result["complete"] and result["censusItems"] == result["items"] == 2
    assert json.loads((tmp_path / result["files"][0]).read_text())["results"]["bindings"] == [
        painting,
        print_,
    ]
    assert fetch_artworks(tmp_path, user_agent="test", fetch=fetch, current_year=2026) == result
    assert calls == [painting_query, flat_query, metadata_query(["Q1", "Q2"])]


def test_repeated_slice_timeout_reports_partial_coverage(tmp_path):
    def fetch(query, **kwargs):
        if "SELECT DISTINCT" in query:
            return [binding("Q1")]
        if "SELECT ?item ?death" in query:
            return [binding("Q1", death="1901-01-01T00:00:00Z")]
        raise httpx.ReadTimeout("deadline")

    result = fetch_artworks(tmp_path, user_agent="test", fetch=fetch)
    assert not result["complete"]
    assert result["missingItems"] == ["Q1"]
    assert "death-1900" in result["failedSlices"][0]["slice"]
    assert json.loads((tmp_path / "stats.json").read_text())["items"] == 0


def test_missing_metadata_is_not_silently_counted_as_complete(tmp_path):
    def fetch(query, **kwargs):
        return [binding("Q1")] if "SELECT DISTINCT" in query else []

    result = fetch_artworks(tmp_path, user_agent="test", fetch=fetch)
    assert result["missingItems"] == ["Q1"]
    assert not result["complete"]


@pytest.mark.parametrize("initial_items", [[], ["Q1"]])
def test_incomplete_checkpoints_retry_missing_items_and_preserve_fetched_rows(
    tmp_path, initial_items
):
    from .wikidata_artworks import metadata_query

    calls = []
    original = [binding(item, image="original.jpg") for item in initial_items]

    def first_fetch(query, **kwargs):
        return [binding("Q1"), binding("Q2")] if "SELECT DISTINCT" in query else original

    first = fetch_artworks(tmp_path, user_agent="test", fetch=first_fetch)
    missing = sorted({"Q1", "Q2"} - set(initial_items))
    assert first["missingItems"] == missing

    recovered = [binding(item, image="recovered.jpg") for item in missing]

    def retry(query, **kwargs):
        calls.append(query)
        assert query == metadata_query(missing)
        return recovered

    second = fetch_artworks(tmp_path, user_agent="test", fetch=retry)
    assert second["complete"] and second["items"] == 2
    assert second["missingItems"] == second["failedSlices"] == []
    assert len(second["files"]) == 1
    rows = json.loads((tmp_path / second["files"][0]).read_text())["results"]["bindings"]
    assert rows == original + recovered
    assert fetch_artworks(tmp_path, user_agent="test", fetch=retry) == second
    assert len(calls) == 1


@pytest.mark.parametrize("decade_recovers", [False, True])
def test_resume_timeouts_preserve_cached_items_and_slice_only_missing_items(
    tmp_path, decade_recovers
):
    from .wikidata_artworks import metadata_query

    original = binding("Q1", image="original.jpg")
    recovered = binding("Q2", image="recovered.jpg")
    fetch_artworks(
        tmp_path,
        user_agent="test",
        fetch=lambda query, **kwargs: (
            [binding("Q1"), binding("Q2")] if "SELECT DISTINCT" in query else [original]
        ),
    )
    attempts = 0

    def retry(query, **kwargs):
        nonlocal attempts
        assert "wd:Q1 " not in query
        if "SELECT ?item ?death" in query:
            return [binding("Q2", death="1901-01-01T00:00:00Z")]
        assert query == metadata_query(["Q2"])
        attempts += 1
        if attempts == 2 and decade_recovers:
            return [recovered]
        raise httpx.ReadTimeout("deadline")

    result = fetch_artworks(tmp_path, user_agent="test", fetch=retry)
    rows = [
        row
        for file in result["files"]
        for row in json.loads((tmp_path / file).read_text())["results"]["bindings"]
    ]
    assert attempts == 2
    assert original in rows
    assert result["complete"] is decade_recovers
    assert result["items"] == len(rows) == (2 if decade_recovers else 1)
    assert result["missingItems"] == ([] if decade_recovers else ["Q2"])
    if not decade_recovers:
        assert result["failedSlices"][0]["items"] == ["Q2"]

    complete = fetch_artworks(
        tmp_path, user_agent="test", fetch=lambda *args, **kwargs: [recovered]
    )
    assert complete["complete"]
    assert len(complete["files"]) == 1
    assert json.loads((tmp_path / complete["files"][0]).read_text())["results"]["bindings"] == [
        original,
        recovered,
    ]


def fixture_records():
    from pathlib import Path

    from ..owner_map import OwnerMap
    from .wikidata_artworks import iter_records

    bindings = json.loads(
        (Path(__file__).parents[2] / "fixtures/wikidata-artworks-sample.json").read_text()
    )["results"]["bindings"]
    owners = OwnerMap({"wikidata:Q160236", "wikidata:Q239303"})
    return list(iter_records(bindings, owners=owners, current_year=2026)), owners


def test_three_wikidata_records_match_the_ingest_contract():
    result, owners = fixture_records()
    actual = [[record.row() if record else None for record in triple] for triple in result[:3]]
    assert actual == [
        [
            {
                "key": "wikidata:Q1",
                "wikidataId": "Q1",
                "title": "Blue sky",
                "artist": "Ada Painter",
                "artistId": "Q10",
                "date": "1900",
                "yearStart": 1900,
                "yearEnd": 1900,
                "rightsStatus": "public_domain",
                "multiplicity": "unknown",
            },
            {
                "key": "wikidata:Q1",
                "artworkKey": "wikidata:Q1",
                "ownerKey": "wikidata:Q160236",
                "accession": "1900.1",
                "source": "corpus",
                "sourceId": "Q1",
                "imageRef": "https://commons.wikimedia.org/wiki/Special:FilePath/Painting%201.jpg",
                "pageUrl": "https://www.wikidata.org/wiki/Q1",
                "thumbnailUrl": "https://commons.wikimedia.org/wiki/Special:FilePath/Painting%201.jpg?width=330",
            },
            {
                "objectKey": "wikidata:Q1",
                "venueKey": "wikidata:Q239303",
                "onView": False,
                "source": "wikidata",
                "confidence": 0.6,
            },
        ],
        [
            {
                "key": "wikidata:Q2",
                "wikidataId": "Q2",
                "title": "City",
                "artist": "Ben Painter",
                "artistId": "Q20",
                "rightsStatus": "in_copyright",
                "multiplicity": "unknown",
            },
            {
                "key": "wikidata:Q2",
                "artworkKey": "wikidata:Q2",
                "accession": "X2",
                "source": "corpus",
                "sourceId": "Q2",
                "imageRef": "https://commons.wikimedia.org/wiki/Special:FilePath/Painting%202.jpg",
                "pageUrl": "https://www.wikidata.org/wiki/Q2",
            },
            None,
        ],
        [
            {
                "key": "wikidata:Q3",
                "wikidataId": "Q3",
                "title": "Study",
                "artist": "Unknown artist",
                "rightsStatus": "unknown",
                "multiplicity": "unknown",
            },
            {
                "key": "wikidata:Q3",
                "artworkKey": "wikidata:Q3",
                "ownerKey": "wikidata:Q160236",
                "source": "corpus",
                "sourceId": "Q3",
                "imageRef": "https://commons.wikimedia.org/wiki/Special:FilePath/Painting%203.jpg",
                "pageUrl": "https://www.wikidata.org/wiki/Q3",
            },
            {
                "objectKey": "wikidata:Q3",
                "venueKey": "wikidata:Q160236",
                "onView": False,
                "source": "wikidata",
                "confidence": 0.5,
            },
        ],
    ]
    assert owners.unmapped == {"Q999": 1}


def test_duplicate_bindings_do_not_duplicate_objects_or_replace_identity_with_series():
    result, _ = fixture_records()
    assert len(result) == 7
    artwork, obj, _ = next(triple for triple in result if triple[0].wikidataId == "Q6")
    assert artwork.seriesId == "wikidata:Q100"
    assert obj.sourceId == "Q6"


def test_multi_owner_accessions_and_locations_are_not_assigned_arbitrarily():
    from ..owner_map import AIC_KEY, MET_KEY, OwnerMap
    from .wikidata_artworks import iter_records

    source = [
        binding(
            "Q1",
            image="http://commons.wikimedia.org/wiki/Special:FilePath/one.jpg",
            collection="http://www.wikidata.org/entity/Q160236",
            accession="met-number",
            location="http://www.wikidata.org/entity/Q160236",
        ),
        binding(
            "Q1",
            image="http://commons.wikimedia.org/wiki/Special:FilePath/one.jpg",
            collection="http://www.wikidata.org/entity/Q239303",
            accession="aic-number",
            location="http://www.wikidata.org/entity/Q239303",
        ),
    ]
    _, obj, placement = next(iter_records(source, owners=OwnerMap({MET_KEY, AIC_KEY})))
    assert obj.ownerKey is None and obj.accession is None and placement is None


def test_missing_coauthor_death_never_inherits_the_other_authors_public_domain():
    from ..owner_map import OwnerMap
    from .wikidata_artworks import iter_records

    source = [
        binding(
            "Q1",
            image="http://commons.wikimedia.org/wiki/Special:FilePath/one.jpg",
            artist="http://www.wikidata.org/entity/Q10",
            death="1800-01-01T00:00:00Z",
        ),
        binding(
            "Q1",
            image="http://commons.wikimedia.org/wiki/Special:FilePath/one.jpg",
            artist="http://www.wikidata.org/entity/Q20",
        ),
    ]
    artwork, obj, _ = next(iter_records(source, owners=OwnerMap(set()), current_year=2026))
    assert artwork.rightsStatus == "unknown" and obj.thumbnailUrl is None


def test_unknown_value_image_claims_are_excluded_without_becoming_urls():
    from ..owner_map import OwnerMap
    from .wikidata_artworks import iter_records

    source = [binding("Q1", image="http://www.wikidata.org/.well-known/genid/unknown")]
    assert list(iter_records(source, owners=OwnerMap(set()))) == []


def test_truncated_json_response_is_recovered_with_decade_slicing(tmp_path):
    attempts = 0

    def fetch(query, **kwargs):
        nonlocal attempts
        if "SELECT DISTINCT" in query:
            return [binding("Q1")]
        if "SELECT ?item ?death" in query:
            return [binding("Q1", death="1901-01-01T00:00:00Z")]
        attempts += 1
        if attempts == 1:
            raise json.JSONDecodeError("truncated", "{", 1)
        return [binding("Q1", image="file.jpg")]

    result = fetch_artworks(tmp_path, user_agent="test", fetch=fetch)
    assert result["complete"] is True
    assert len(result["files"]) == 1
    assert "death-1900" in result["files"][0]


def test_unknown_coauthor_and_coowner_claims_do_not_disappear_during_parsing():
    from ..owner_map import MET_KEY, OwnerMap
    from .wikidata_artworks import iter_records

    source = [
        binding(
            "Q1",
            image="http://commons.wikimedia.org/wiki/Special:FilePath/one.jpg",
            artist="http://www.wikidata.org/entity/Q10",
            death="1800-01-01T00:00:00Z",
            collection="http://www.wikidata.org/entity/Q160236",
        ),
        binding(
            "Q1",
            image="http://commons.wikimedia.org/wiki/Special:FilePath/one.jpg",
            artist="http://www.wikidata.org/.well-known/genid/unknown",
            collection="http://www.wikidata.org/.well-known/genid/unknown",
        ),
    ]
    artwork, obj, placement = next(
        iter_records(source, owners=OwnerMap({MET_KEY}), current_year=2026)
    )
    assert artwork.rightsStatus == "unknown"
    assert obj.ownerKey is None and placement is None


def test_unknown_death_claim_does_not_get_discarded_in_favor_of_an_older_date():
    from ..owner_map import OwnerMap
    from .wikidata_artworks import iter_records

    source = [
        binding(
            "Q1",
            image="http://commons.wikimedia.org/wiki/Special:FilePath/one.jpg",
            artist="http://www.wikidata.org/entity/Q10",
            death="1800-01-01T00:00:00Z",
        ),
        binding(
            "Q1",
            image="http://commons.wikimedia.org/wiki/Special:FilePath/one.jpg",
            artist="http://www.wikidata.org/entity/Q10",
            death="http://www.wikidata.org/.well-known/genid/unknown",
        ),
    ]
    artwork, obj, _ = next(iter_records(source, owners=OwnerMap(set()), current_year=2026))
    assert artwork.rightsStatus == "unknown" and obj.thumbnailUrl is None


@pytest.mark.parametrize("coauthored", [False, True])
def test_anonymous_creator_entities_remain_unknown_even_with_a_known_coauthor(coauthored):
    from ..multiplicity import apply_multiplicity
    from ..owner_map import OwnerMap
    from .wikidata_artworks import iter_records

    source = [
        binding(
            "Q1",
            itemLabel="Nativity",
            image="http://commons.wikimedia.org/wiki/Special:FilePath/one.jpg",
            artist="http://www.wikidata.org/entity/Q4233718",
            artistLabel="anonymous",
        ),
    ]
    if coauthored:
        source.append(
            binding(
                "Q1",
                itemLabel="Nativity",
                image="http://commons.wikimedia.org/wiki/Special:FilePath/one.jpg",
                artist="http://www.wikidata.org/entity/Q10",
                artistLabel="Ada Painter",
                death="1800-01-01T00:00:00Z",
            )
        )
    artwork, _, _ = next(iter_records(source, owners=OwnerMap(set()), current_year=2026))
    result = apply_multiplicity([artwork], version_items=set(), complete=True)[0]
    assert result.multiplicity == "unknown"
    assert result.artist == ("Ada Painter; Unknown artist" if coauthored else "Unknown artist")
    assert result.artistId is None
    assert result.rightsStatus == "unknown"


def test_a_named_creator_is_not_anonymous_just_because_its_label_matches():
    from ..multiplicity import apply_multiplicity
    from ..owner_map import OwnerMap
    from .wikidata_artworks import iter_records

    source = [
        binding(
            "Q1",
            itemLabel="Nativity",
            image="http://commons.wikimedia.org/wiki/Special:FilePath/one.jpg",
            artist="http://www.wikidata.org/entity/Q10",
            artistLabel="anonymous",
        ),
    ]
    artwork, _, _ = next(iter_records(source, owners=OwnerMap(set())))
    result = apply_multiplicity([artwork], version_items=set(), complete=True)[0]
    assert result.multiplicity == "unique"
    assert result.artistId == "Q10"


def test_other_flat_works_must_be_public_domain_and_prints_are_multiples():
    result, _ = fixture_records()
    by_id = {artwork.wikidataId: (artwork, obj) for artwork, obj, _ in result}
    print_artwork, print_object = by_id["Q7"]
    assert print_artwork.multiplicity == "multiple"
    assert print_object.medium == "print"
    assert by_id["Q1"][1].medium is None
    # The drawing's artist fails the fixture's public-domain age cutoff.
    assert "Q8" not in by_id


def named(qid, **names):
    """A metadata row whose `names` give fields as (text, language) literals."""
    row = binding(qid, image="http://commons.wikimedia.org/wiki/Special:FilePath/one.jpg")
    for field, (text, language) in names.items():
        row[field] = {
            "type": "literal",
            "value": text,
            **({"xml:lang": language} if language else {}),
        }
    return row


@pytest.mark.parametrize(
    ("labels", "titles", "expected"),
    [
        # An English label wins; English readers see the multilingual label when there is none.
        (
            [("Winter at Kronborg", "en"), ("Vinter", "da")],
            [("Helsingør mod Kronborg, vinter", "da")],
            "Winter at Kronborg",
        ),
        ([("Kronborg in Winter", "en-gb"), ("Kronborg", "mul")], [], "Kronborg"),
        ([("Kronborg", "mul"), ("Hiver", "fr")], [("Vinter", "da")], "Kronborg"),
        # Then the work's title claim, in English when it has one.
        (
            [("Vinter", "da")],
            [("Helsingør mod Kronborg, vinter", "da"), ("Elsinore toward Kronborg", "en")],
            "Elsinore toward Kronborg",
        ),
        (
            [("Hiver", "fr")],
            [("Helsingør mod Kronborg, vinter", "da")],
            "Helsingør mod Kronborg, vinter",
        ),
        # Then a label in any language, the same way every time.
        ([("Vinter", "sv"), ("Hiver", "fr"), ("Inverno", "it")], [], "Hiver"),
        ([("Hiver", "fr"), ("Kronborg in Winter", "en-gb")], [], "Kronborg in Winter"),
        ([("Vinter", "sv"), ("Vinter i Helsingør", "da")], [], "Vinter i Helsingør"),
        # Never the item ID, which the label service returns for an item without a label.
        ([("Q103036181", "")], [], "Untitled"),
        ([(" ", "da")], [], "Untitled"),
        ([], [], "Untitled"),
    ],
)
def test_titles_prefer_english_labels_then_title_claims_then_any_label(labels, titles, expected):
    assert artwork_title("Q103036181", labels, titles) == expected


def test_an_unlabeled_item_takes_its_title_claim_and_never_its_id():
    from ..owner_map import OwnerMap
    from .wikidata_artworks import iter_records

    source = [
        named("Q103036181", title=("Helsingør mod Kronborg, vinter", "da")),
        named("Q2", nameAny=("Vinter", "nb")),
        named("Q3"),
        # Snapshots fetched with the label service name unlabeled items by their ID.
        named("Q4", itemLabel=("Q4", "")),
        named("Q5", itemLabel=("Hiver", "fr")),
    ]
    records = iter_records(source, owners=OwnerMap(set()), current_year=2026)
    assert {artwork.wikidataId: artwork.title for artwork, _, _ in records} == {
        "Q103036181": "Helsingør mod Kronborg, vinter",
        "Q2": "Vinter",
        "Q3": "Untitled",
        "Q4": "Untitled",
        "Q5": "Hiver",
    }


def test_an_unlabeled_artist_is_unknown_and_never_named_by_their_id():
    from ..owner_map import OwnerMap
    from .wikidata_artworks import iter_records

    def by(qid, artist, **names):
        return named(qid, **names) | {
            "artist": {"value": f"http://www.wikidata.org/entity/{artist}"}
        }

    source = [
        by("Q1", "Q10", artistName=("Thomas Fearnley", "en")),
        by("Q2", "Q20", artistAny=("Tómas Fearnley", "is")),
        by("Q2", "Q20", artistAny=("Thomas Fearnley", "nb")),
        by("Q3", "Q30"),
        # Snapshots fetched with the label service name unlabeled artists by their ID.
        by("Q4", "Q40", artistLabel=("Q40", "")),
        by("Q5", "Q10", artistName=("Thomas Fearnley", "en")),
        by("Q5", "Q50", artistLabel=("Q50", "")),
    ]
    records = iter_records(source, owners=OwnerMap(set()), current_year=2026)
    assert {artwork.wikidataId: artwork.artist for artwork, _, _ in records} == {
        "Q1": "Thomas Fearnley",
        "Q2": "Tómas Fearnley",
        "Q3": "Unknown artist",
        "Q4": "Unknown artist",
        "Q5": "Thomas Fearnley; Unknown artist",
    }
