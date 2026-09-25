import json
from collections.abc import Mapping
from typing import NotRequired, TypedDict

from .model_version import REPO_ROOT
from .wikidata import VenueRow, distance_km


class Region(TypedDict):
    name: str
    domains: list[str]
    country: NotRequired[str]
    center: NotRequired[list[float]]
    adminQids: NotRequired[list[str]]


def load_regions() -> dict[str, Region]:
    return json.loads((REPO_ROOT / "shared/sources/regions.json").read_text())


def region_for(row: VenueRow, regions_config: Mapping[str, Region]) -> str:
    candidates = []
    for key, region in regions_config.items():
        if "center" not in region or region.get("country") != row.country_iso:
            continue
        distance = distance_km(row.lat, row.lng, region["center"])
        admin_match = bool(set(row.admin_qids).intersection(region.get("adminQids", [])))
        if admin_match or distance <= 60:
            candidates.append((not admin_match, distance, key))
    return min(candidates)[2] if candidates else f"country:{row.country_iso}"
