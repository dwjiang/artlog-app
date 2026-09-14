import json
from pathlib import Path

from .aic import iter_records

FIXTURES = Path(__file__).parents[2] / "fixtures"


def rows():
    return json.loads((FIXTURES / "aic-sample.json").read_text())["data"]


def test_three_aic_records_match_the_ingest_contract():
    actual = [
        [record.row() if record else None for record in triple]
        for triple in list(iter_records(rows(), image_width=1686))[:3]
    ]
    assert actual == [
        [
            {
                "key": "aic:1",
                "title": "Garden",
                "artist": "Ada Painter",
                "artistId": "aic:10",
                "date": "1900",
                "yearStart": 1900,
                "yearEnd": 1900,
                "rightsStatus": "public_domain",
                "multiplicity": "unknown",
            },
            {
                "key": "aic:1",
                "artworkKey": "aic:1",
                "ownerKey": "wikidata:Q239303",
                "accession": "1900.1",
                "medium": "Oil",
                "source": "corpus",
                "sourceId": "1",
                "imageRef": "https://www.artic.edu/iiif/2/image-1/full/1686,/0/default.jpg",
                "pageUrl": "https://www.artic.edu/artworks/1",
                "thumbnailUrl": "https://www.artic.edu/iiif/2/image-1/full/843,/0/default.jpg",
            },
            {
                "objectKey": "aic:1",
                "venueKey": "wikidata:Q239303",
                "gallery": "Gallery 10",
                "onView": True,
                "source": "feed",
                "confidence": 0.9,
            },
        ],
        [
            {
                "key": "aic:2",
                "title": "Town",
                "artist": "Unknown artist",
                "rightsStatus": "in_copyright",
                "multiplicity": "unknown",
            },
            {
                "key": "aic:2",
                "artworkKey": "aic:2",
                "ownerKey": "wikidata:Q239303",
                "accession": "1900.2",
                "source": "corpus",
                "sourceId": "2",
                "imageRef": "https://www.artic.edu/iiif/2/image-2/full/1686,/0/default.jpg",
                "pageUrl": "https://www.artic.edu/artworks/2",
            },
            {
                "objectKey": "aic:2",
                "venueKey": "wikidata:Q239303",
                "onView": False,
                "source": "feed",
                "confidence": 0.9,
            },
        ],
        [
            {
                "key": "aic:3",
                "title": "Sketch",
                "artist": "Unknown artist",
                "rightsStatus": "unknown",
                "multiplicity": "unknown",
            },
            {
                "key": "aic:3",
                "artworkKey": "aic:3",
                "ownerKey": "wikidata:Q239303",
                "accession": "1900.3",
                "source": "corpus",
                "sourceId": "3",
                "imageRef": "https://www.artic.edu/iiif/2/image-3/full/1686,/0/default.jpg",
                "pageUrl": "https://www.artic.edu/artworks/3",
            },
            {
                "objectKey": "aic:3",
                "venueKey": "wikidata:Q239303",
                "onView": False,
                "source": "feed",
                "confidence": 0.9,
            },
        ],
    ]


def test_blocked_images_are_not_eligible_and_stale_dump_has_no_current_placement():
    result = list(iter_records(rows(), current=False))
    assert len(result) == 4
    assert all(
        obj.imageRef is None and obj.thumbnailUrl is None and placement is None
        for _, obj, placement in result
    )


def test_permitted_smaller_iiif_size_is_used_for_embedding():
    assert next(iter_records(rows(), image_width=843))[1].imageRef.endswith(
        "/full/843,/0/default.jpg"
    )
