from .owner_map import LOUVRE_KEY, MET_KEY, OwnerMap
from .reown import corrections


def binding(item, collection):
    return {
        "item": {"type": "uri", "value": f"http://www.wikidata.org/entity/{item}"},
        "itemLabel": {"type": "literal", "value": "Painting"},
        "cls": {"type": "uri", "value": "http://www.wikidata.org/entity/Q3305213"},
        "image": {
            "type": "uri",
            "value": f"http://commons.wikimedia.org/wiki/Special:FilePath/{item}.jpg",
        },
        "collection": {"type": "uri", "value": f"http://www.wikidata.org/entity/{collection}"},
        "copyright": {"type": "uri", "value": "http://www.wikidata.org/entity/Q19652"},
    }


def imported(item, owner=None):
    return {"key": f"wikidata:{item}", "artworkKey": f"wikidata:{item}", "ownerKey": owner}


def test_only_imported_objects_without_an_owner_gain_the_one_the_map_now_resolves():
    rows = [
        imported("Q1"),
        # Already owned, or owned by a museum the run did not ask for.
        imported("Q2", owner=MET_KEY),
        imported("Q3"),
    ]
    found = corrections(
        # Department of Paintings of the Louvre, and the Met.
        [
            [binding("Q1", "Q3044768"), binding("Q2", "Q3044768"), binding("Q3", "Q160236")],
            [binding("Q4", "Q3044768")],
        ],
        {row["key"]: row for row in rows},
        OwnerMap({LOUVRE_KEY, MET_KEY}),
        {LOUVRE_KEY},
    )
    assert list(found) == [{**rows[0], "ownerKey": LOUVRE_KEY}]
