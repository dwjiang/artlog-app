from .gardner import match, parse_guide

GUIDE = """<nav>
<div class="nav__item" data-modal-main-target="1"> North Wall </div>
<div class="nav__item" data-modal-main-target="2"> West Wall </div>
</nav>
<div class="wall-guide-content" data-modal-wall-index="1">
<h4>1. Santa Maria della Salute, Venice,</h4><p>1903-07. John S. Sargent. Photographic reproduction of a watercolor</p>
<h4>2. Miss Violet Sargent,</h4><p>1890. John S. Sargent (American, 1856–1925). Oil on canvas</p>
<h4>3. The Concert</h4><p>1663–1666. Johannes Vermeer. Oil on canvas. Stolen March 18, 1990</p>
</div>
<div class="wall-guide-content" data-modal-wall-index="2">
<h4>4. Side Chair (four in this room).</h4><p>Italian, late 18th century. Painted walnut</p>
<h4>5. Portrait of a Woman,</h4><p>about 1600. Unknown. Oil on panel</p>
<h4>6. Portrait of a Woman,</h4><p>about 1610. Unknown. Oil on panel</p>
</div>"""
URL = "https://www.gardnermuseum.org/experience/rooms/blue-room"


def entries():
    return parse_guide("Blue Room", URL, GUIDE)


def item(title, *, artists=(), accession=None):
    return {
        "titles": {title},
        "artists": set(artists),
        "accessions": {accession} if accession else set(),
    }


def test_guides_list_works_by_wall_without_stolen_frames_or_stand_in_photographs():
    assert [(entry["id"], entry["title"], entry["gallery"]) for entry in entries()] == [
        ("blue-room.1.2", "Miss Violet Sargent", "Blue Room, North Wall"),
        ("blue-room.2.4", "Side Chair (four in this room)", "Blue Room, West Wall"),
        ("blue-room.2.5", "Portrait of a Woman", "Blue Room, West Wall"),
        ("blue-room.2.6", "Portrait of a Woman", "Blue Room, West Wall"),
    ]


def test_an_item_matches_the_one_entry_with_its_title_and_its_artists_surname():
    rows = match(
        entries(),
        {
            "Q1": item("Miss Violet Sargent.", artists=["John Singer Sargent"], accession="P3w35"),
            # The title matches but the guide names another artist.
            "Q2": item("Side Chair", artists=["Thomas Chippendale"]),
            # Two entries carry this title, so neither can be told apart.
            "Q3": item("Portrait of a Woman"),
        },
    )
    assert rows == [
        {
            "id": "blue-room.1.2",
            "wikidataId": "Q1",
            "accession": "P3w35",
            "title": "Miss Violet Sargent",
            "artist": "John Singer Sargent",
            "url": URL,
            "onView": True,
            "gallery": "Blue Room, North Wall",
        }
    ]


def test_an_entry_two_items_claim_is_left_out():
    rows = match(
        entries(),
        {
            "Q1": item("Miss Violet Sargent", artists=["John Singer Sargent"]),
            "Q2": item("Miss Violet Sargent", artists=["John Singer Sargent"]),
        },
    )
    assert rows == []


def test_an_ambiguous_item_still_blocks_other_claimants_to_its_entries():
    guide_entries = [
        {
            "id": str(index),
            "title": title,
            "detail": "John Singer Sargent. Oil on canvas",
            "url": URL,
            "gallery": "Blue Room",
        }
        for index, title in enumerate(("Portrait of a Woman", "Portrait of Woman"))
    ]
    rows = match(
        guide_entries,
        {
            "Q1": item("Portrait of a Woman", artists=["John Singer Sargent"]),
            "Q2": item("Portrait of an Old Woman", artists=["John Singer Sargent"]),
        },
    )
    assert rows == []
