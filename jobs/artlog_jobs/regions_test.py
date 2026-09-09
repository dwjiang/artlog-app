from dataclasses import replace

from .regions import load_regions, region_for
from .wikidata import VenueRow

SF = VenueRow("Q1", "Museum", 37.7857, -122.4011, "https://museum.example", "US")


def test_bay_area_coordinates_and_rural_country_fallback():
    config = load_regions()
    assert region_for(SF, config) == "sf-bay-area"
    assert region_for(replace(SF, lat=41, lng=-100), config) == "country:US"


def test_country_must_match_even_when_admin_or_coordinates_match():
    assert (
        region_for(replace(SF, country_iso="CA", admin_qids=("Q62",)), load_regions())
        == "country:CA"
    )
    assert region_for(replace(SF, country_iso="unknown"), load_regions()) == "country:unknown"


def test_administrative_ancestry_matches_beyond_the_radius():
    assert (
        region_for(replace(SF, lat=36.9, admin_qids=("Q123", "Q62")), load_regions())
        == "sf-bay-area"
    )


def test_nearest_metro_wins_and_ties_use_key_independent_of_config_order():
    config = {
        "far": {"name": "Far", "country": "US", "domains": [], "center": [37.9, -122.4]},
        "near": {"name": "Near", "country": "US", "domains": [], "center": [SF.lat, SF.lng]},
    }
    assert region_for(SF, config) == "near"
    config["first"] = config["near"]
    assert region_for(SF, config) == "first"
    assert region_for(SF, dict(reversed(list(config.items())))) == "first"


def test_admin_match_takes_priority_over_nearer_center():
    config = {
        "near": {"name": "Near", "country": "US", "domains": [], "center": [SF.lat, SF.lng]},
        "admin": {
            "name": "Admin",
            "country": "US",
            "domains": [],
            "center": [38, -122],
            "adminQids": ["Q62"],
        },
    }
    assert region_for(replace(SF, admin_qids=("Q62",)), config) == "admin"
