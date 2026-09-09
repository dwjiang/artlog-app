import json
import math
from collections.abc import Mapping
from typing import NotRequired, TypedDict

from .model_version import REPO_ROOT
from .wikidata import VenueRow


class Region(TypedDict):
    name: str
    domains: list[str]
    country: NotRequired[str]
    center: NotRequired[list[float]]
    adminQids: NotRequired[list[str]]


def load_regions() -> dict[str, Region]:
    return json.loads((REPO_ROOT / "shared/regions.json").read_text())


def distance_km(lat: float, lng: float, center: list[float]) -> float:
    lat1, lat2 = math.radians(lat), math.radians(center[0])
    dlat, dlng = lat2 - lat1, math.radians(center[1] - lng)
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(min(1, max(0, a))))


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
