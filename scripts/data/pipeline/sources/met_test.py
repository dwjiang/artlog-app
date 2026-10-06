import json
from pathlib import Path

from .met import iter_records

FIXTURES = Path(__file__).parents[2] / "fixtures"


def records():
    images = json.loads((FIXTURES / "met-images-sample.json").read_text())
    return list(iter_records(FIXTURES / "met-sample.csv", get_object=images.__getitem__))


def test_three_met_records_match_the_ingest_contract():
    actual = [[record.row() if record else None for record in triple] for triple in records()[:3]]
    assert actual == [
        [
            {
                "key": "met:1",
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
                "key": "met:1",
                "artworkKey": "met:1",
                "ownerKey": "wikidata:Q160236",
                "accession": "1900.1",
                "medium": "Oil on canvas",
                "dimensions": "10 x 20 cm",
                "source": "corpus",
                "sourceId": "1",
                "imageRef": "https://images.metmuseum.org/one.jpg",
                "pageUrl": "https://www.metmuseum.org/art/collection/search/1",
                "thumbnailUrl": "https://images.metmuseum.org/small-one.jpg",
            },
            {
                "objectKey": "met:1",
                "venueKey": "wikidata:Q160236",
                "gallery": "101",
                "onView": True,
                "source": "feed",
                "confidence": 0.9,
            },
        ],
        [
            {
                "key": "met:2",
                "title": "City",
                "artist": "Ben Painter",
                "rightsStatus": "unknown",
                "multiplicity": "unknown",
            },
            {
                "key": "met:2",
                "artworkKey": "met:2",
                "ownerKey": "wikidata:Q160236",
                "accession": "1900.2",
                "source": "corpus",
                "sourceId": "2",
                "pageUrl": "https://www.metmuseum.org/art/collection/search/2",
            },
            {
                "objectKey": "met:2",
                "venueKey": "wikidata:Q160236",
                "onView": False,
                "source": "feed",
                "confidence": 0.9,
            },
        ],
        [
            {
                "key": "met:3",
                "title": "Study",
                "artist": "Unknown artist",
                "rightsStatus": "public_domain",
                "multiplicity": "unknown",
            },
            {
                "key": "met:3",
                "artworkKey": "met:3",
                "ownerKey": "wikidata:Q160236",
                "accession": "1900.3",
                "source": "corpus",
                "sourceId": "3",
                "pageUrl": "https://www.metmuseum.org/art/collection/search/3",
            },
            {
                "objectKey": "met:3",
                "venueKey": "wikidata:Q160236",
                "onView": False,
                "source": "feed",
                "confidence": 0.9,
            },
        ],
    ]


def test_met_only_hydrates_public_domain_works_and_honors_revocation():
    images = json.loads((FIXTURES / "met-images-sample.json").read_text())
    calls = []

    def fetch(id):
        calls.append(id)
        return images[id]

    result = {
        artwork.key: (artwork, obj)
        for artwork, obj, _ in iter_records(FIXTURES / "met-sample.csv", get_object=fetch)
    }
    assert calls == ["1", "3", "6", "7"]
    assert list(result) == ["met:1", "met:2", "met:3", "met:5", "met:6", "met:7"]
    artwork, obj = result["met:6"]
    assert artwork.rightsStatus == "unknown"
    assert obj.imageRef is None and obj.thumbnailUrl is None


def test_met_keeps_public_domain_flat_works_and_treats_prints_as_multiples():
    artwork, obj, placement = next(triple for triple in records() if triple[0].key == "met:7")
    assert artwork.multiplicity == "multiple"
    assert obj.imageRef == "https://images.metmuseum.org/seven.jpg"
    assert placement.onView is False


def test_unavailable_met_image_metadata_is_reported_and_checkpointed(tmp_path):
    import httpx

    from ..polite_http import PoliteClient
    from .met import MetHydrator

    calls = []

    def handler(request):
        calls.append(request.url.path)
        return httpx.Response(403)

    with PoliteClient(
        user_agent="test",
        robots=False,
        transport=httpx.MockTransport(handler),
        sleep=lambda _: None,
    ) as client:
        hydrate = MetHydrator(tmp_path / "objects", client, sleep=lambda _: None)
        data = hydrate("123")
        assert hydrate("123") == data
    assert data["httpStatus"] == 403
    assert len(calls) == 3


def test_met_stops_network_requests_after_repeated_denials_and_reports_unchecked_rows(tmp_path):
    import httpx

    from ..polite_http import PoliteClient
    from .met import MetHydrator

    calls = []

    def handler(request):
        calls.append(request.url.path)
        return httpx.Response(403)

    with PoliteClient(
        user_agent="test",
        robots=False,
        per_host_rps=20,
        sleep=lambda _: None,
        transport=httpx.MockTransport(handler),
    ) as client:
        hydrate = MetHydrator(tmp_path / "objects", client, sleep=lambda _: None)
        for id in range(1, 6):
            hydrate(str(id))
        assert hydrate.stats == {
            "checked": 1,
            "forbidden": 1,
            "notFound": 0,
            "notRequested": 4,
            "requests": 3,
            "recovered": 0,
        }
        assert len(calls) == 3
        retry = MetHydrator(tmp_path / "objects", client)
        assert retry("6")["notRequested"] is True
        assert len(calls) == 3


def test_explicit_met_recovery_retries_denials_preserves_successes_and_fills_missing_rows(tmp_path):
    import httpx

    from ..polite_http import PoliteClient
    from .fetch import write_json
    from .met import MetHydrator

    cache = tmp_path / "objects"
    good = {"objectID": 1, "isPublicDomain": True, "primaryImage": "https://example.org/1.jpg"}
    write_json(cache / "1.json", good)
    write_json(cache / "2.json", {"objectID": 2, "httpStatus": 403, "unavailable": True})
    write_json(cache / "4.json", {"objectID": 4, "httpStatus": 404, "unavailable": True})
    write_json(tmp_path / "image-access.json", {"blocked": True})
    calls, sleeps = [], []

    def handler(request):
        id = int(request.url.path.rsplit("/", 1)[1])
        calls.append(id)
        if len(calls) == 1:
            return httpx.Response(403, headers={"Retry-After": "20"})
        return httpx.Response(200, json={"objectID": id, "isPublicDomain": True})

    with PoliteClient(
        user_agent="test",
        robots=False,
        sleep=lambda _: None,
        transport=httpx.MockTransport(handler),
    ) as client:
        hydrate = MetHydrator(cache, client, retry_denied=True, sleep=sleeps.append)
        assert hydrate("1") == good
        assert hydrate("2")["objectID"] == 2
        assert hydrate("3")["objectID"] == 3
        assert hydrate("4")["httpStatus"] == 404
        assert hydrate.stats["recovered"] == 1
        assert hydrate.stats["forbidden"] == 0
    assert calls == [2, 2, 3]
    assert sleeps == [20]
    assert not (tmp_path / "image-access.json").exists()
    assert json.loads((cache / "1.json").read_text()) == good
    assert "httpStatus" not in json.loads((cache / "2.json").read_text())


def test_failed_met_recovery_keeps_cached_denials_and_stops_after_bounded_cooldowns(tmp_path):
    import httpx

    from ..polite_http import PoliteClient
    from .fetch import write_json
    from .met import MetHydrator

    for id in [1, 2]:
        write_json(tmp_path / "objects" / f"{id}.json", {"objectID": id, "httpStatus": 403})
    calls, sleeps = [], []

    def handler(request):
        calls.append(request.url.path)
        return httpx.Response(403)

    with PoliteClient(
        user_agent="test",
        robots=False,
        sleep=lambda _: None,
        transport=httpx.MockTransport(handler),
    ) as client:
        hydrate = MetHydrator(tmp_path / "objects", client, retry_denied=True, sleep=sleeps.append)
        assert hydrate("1")["httpStatus"] == 403
        assert hydrate("2")["httpStatus"] == 403
        assert hydrate("3")["notRequested"] is True
    assert len(calls) == 3
    assert sleeps == [15, 30]
    assert (tmp_path / "image-access.json").exists()


def test_met_stops_without_ignoring_a_long_server_cooldown(tmp_path):
    import httpx

    from ..polite_http import PoliteClient
    from .met import MetHydrator

    calls, sleeps = [], []

    def handler(request):
        calls.append(request.url.path)
        return httpx.Response(403, headers={"Retry-After": "3600"})

    with PoliteClient(
        user_agent="test", robots=False, transport=httpx.MockTransport(handler)
    ) as client:
        hydrate = MetHydrator(tmp_path / "objects", client, retry_denied=True, sleep=sleeps.append)
        assert hydrate("1")["httpStatus"] == 403
        assert hydrate("2")["notRequested"] is True
        resumed = MetHydrator(tmp_path / "objects", client, retry_denied=True, sleep=sleeps.append)
        assert resumed("1")["httpStatus"] == 403
        assert resumed("2")["notRequested"] is True
    assert len(calls) == 1 and sleeps == []
