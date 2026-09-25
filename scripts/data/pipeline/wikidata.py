import json
import logging
import math
import re
import threading
import time
from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import httpx
from tenacity import Retrying, before_sleep_log, retry_if_exception, stop_after_attempt

from .polite_http import parse_retry_after

log = logging.getLogger(__name__)
ENDPOINT = "https://query.wikidata.org/sparql"
SLICE_LIMIT = 20_000
MAX_VENUES = 150_000
_request_lock = threading.Lock()
_next_request = 0.0


@dataclass(frozen=True)
class VenueRow:
    qid: str
    name: str
    lat: float
    lng: float
    website: str | None
    country_iso: str
    admin_qids: tuple[str, ...] = ()
    city: str | None = None
    city_key: str | None = None


class IncompleteCountry(RuntimeError):
    pass


def _transient(error: BaseException) -> bool:
    return isinstance(error, httpx.TransportError) or (
        isinstance(error, httpx.HTTPStatusError)
        and (error.response.status_code == 429 or error.response.status_code >= 500)
    )


def _retry_delay(state: Any) -> float:
    error = state.outcome.exception()
    if isinstance(error, httpx.HTTPStatusError):
        delay = parse_retry_after(error.response.headers.get("Retry-After"), time.time())
        if delay is not None:
            return delay
    return min(30, 2**state.attempt_number)


def sparql(query: str, *, user_agent: str) -> list[dict]:
    if not user_agent.strip():
        raise ValueError("Wikidata requires an identified User-Agent")
    global _next_request
    # Sequential requests also keep retries within the WDQS concurrency budget.
    with (
        _request_lock,
        httpx.Client(
            headers={"User-Agent": user_agent, "Accept": "application/sparql-results+json"},
            timeout=65,
        ) as client,
    ):
        for attempt in Retrying(
            stop=stop_after_attempt(3),
            retry=retry_if_exception(_transient),
            wait=_retry_delay,
            before_sleep=before_sleep_log(log, logging.WARNING),
            reraise=True,
        ):
            with attempt:
                time.sleep(max(0, _next_request - time.monotonic()))
                try:
                    response = client.post(ENDPOINT, data={"query": query, "format": "json"})
                    if response.status_code == 429 or response.status_code >= 500:
                        delay = parse_retry_after(response.headers.get("Retry-After"), time.time())
                        if delay is not None:
                            _next_request = time.monotonic() + delay
                    response.raise_for_status()
                    return response.json()["results"]["bindings"]
                finally:
                    _next_request = max(_next_request, time.monotonic() + 1)
    raise AssertionError("Retrying exhausted without a result or exception")


def _qid(value: str) -> str:
    result = value.rsplit("/", 1)[-1]
    if not re.fullmatch(r"Q[1-9][0-9]*", result):
        raise ValueError(f"Invalid Wikidata ID: {value}")
    return result


def _values(qids: Sequence[str]) -> str:
    return " ".join(f"wd:{_qid(qid)}" for qid in qids)


def _point(value: str) -> tuple[float, float] | None:
    coord = re.fullmatch(r"Point\(([-+\d.eE]+) ([-+\d.eE]+)\)", value)
    if coord is None:
        return None
    lng, lat = map(float, coord.groups())
    if not (math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    return lat, lng


def distance_km(lat: float, lng: float, center: Sequence[float]) -> float:
    lat1, lat2 = math.radians(lat), math.radians(center[0])
    dlat, dlng = lat2 - lat1, math.radians(center[1] - lng)
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(min(1, max(0, a))))


def parse_venues(bindings: list[dict], country_iso: str) -> list[VenueRow]:
    venues: dict[str, VenueRow] = {}
    for binding in bindings:
        value = {key: entry["value"] for key, entry in binding.items()}
        point = _point(value.get("coord", ""))
        if point is None or not value.get("website"):
            continue
        lat, lng = point
        qid = _qid(value["m"])
        admins = {
            value[key].rsplit("/", 1)[-1]
            for key in ("admin", "metroAdmin")
            if key in value and re.fullmatch(r"Q[1-9][0-9]*", value[key].rsplit("/", 1)[-1])
        }
        # Wikidata's "some value" nodes are claims of unknown values, not website URLs.
        website = value["website"]
        if binding["website"].get("type") == "bnode" or "/.well-known/genid/" in website:
            website = None
        previous = venues.get(qid)
        if previous:
            admins.update(previous.admin_qids)
        name = value.get("nameEn") or value.get("nameAny") or qid
        venues[qid] = VenueRow(
            qid=qid,
            name=value.get("nameEn") or (previous.name if previous else name),
            lat=previous.lat if previous else lat,
            lng=previous.lng if previous else lng,
            website=(previous.website or website) if previous else website,
            country_iso=country_iso,
            admin_qids=tuple(sorted(admins)),
        )
    return list(venues.values())


def _museum_pattern(country_qids: Sequence[str]) -> str:
    return f"""VALUES ?class {{ wd:Q33506 wd:Q1007870 }} ?type wdt:P279* ?class .
      ?m wdt:P31 ?type; wdt:P625 ?coord; wdt:P856 ?website .
      VALUES ?country {{ {_values(country_qids)} }} ?m wdt:P17 ?country .
    """


def _venue_query(
    country_qids: Sequence[str],
    admin: str | None,
    metros: Sequence[str],
    venue_qids: Sequence[str] | None = None,
) -> str:
    admin_filter = ""
    if admin == "unknown":
        admin_filter = """FILTER NOT EXISTS {
          ?m wdt:P131 ?area . FILTER(REGEX(STR(?area), "/Q[1-9][0-9]*$"))
        }"""
    elif admin:
        admin_filter = f"?m wdt:P131 wd:{_qid(admin)} ."
    ancestry = (
        f"OPTIONAL {{ ?m wdt:P131 ?ancestorStart . VALUES ?metroAdmin {{ {_values(metros)} }} "
        "?ancestorStart wdt:P131* ?metroAdmin }"
        if metros
        else ""
    )
    selection = (
        f"VALUES ?m {{ {_values(venue_qids)} }} ?m wdt:P625 ?coord; wdt:P856 ?website ."
        if venue_qids is not None
        else _museum_pattern(country_qids)
    )
    # LIMIT applies before labels/ancestry multiply rows. Detect the cap on this projection.
    return f"""SELECT ?m ?coord ?website ?admin ?nameEn ?nameAny ?metroAdmin WHERE {{
      {{ SELECT DISTINCT ?m ?coord ?website ?admin WHERE {{
        {selection}
        {admin_filter}
        OPTIONAL {{ ?m wdt:P131 ?admin }}
      }} LIMIT {SLICE_LIMIT} }}
      OPTIONAL {{ ?m rdfs:label ?nameEn . FILTER(LANG(?nameEn) = "en") }}
      OPTIONAL {{
        ?m rdfs:label ?nameAny .
        FILTER NOT EXISTS {{ ?m rdfs:label ?english . FILTER(LANG(?english) = "en") }}
      }}
      {ancestry}
    }}"""


def _at_limit(bindings: list[dict]) -> bool:
    return (
        len(
            {
                tuple(row.get(key, {}).get("value") for key in ("m", "coord", "website", "admin"))
                for row in bindings
            }
        )
        >= SLICE_LIMIT
    )


def _country_bindings(
    iso: str,
    qids: Sequence[str],
    *,
    user_agent: str,
    metro_admin_qids: Sequence[str],
    fetch: Callable[..., list[dict]],
) -> list[dict]:
    try:
        bindings = fetch(_venue_query(qids, None, metro_admin_qids), user_agent=user_agent)
    except (httpx.TimeoutException, httpx.HTTPStatusError) as error:
        if isinstance(error, httpx.HTTPStatusError) and error.response.status_code not in (
            500,
            502,
            503,
            504,
        ):
            raise
        log.warning("%s country query failed; slicing by administrative area", iso)
        bindings = None
    if bindings is None or _at_limit(bindings):
        try:
            areas = fetch(
                f"SELECT DISTINCT ?admin WHERE {{ {_museum_pattern(qids)} ?m wdt:P131 ?admin }}",
                user_agent=user_agent,
            )
            bindings = []
            admin_qids = {
                row["admin"]["value"].rsplit("/", 1)[-1]
                for row in areas
                if re.fullmatch(r"Q[1-9][0-9]*", row["admin"]["value"].rsplit("/", 1)[-1])
            }
            for admin in sorted(admin_qids) + ["unknown"]:
                rows = fetch(_venue_query(qids, admin, metro_admin_qids), user_agent=user_agent)
                if _at_limit(rows):
                    raise IncompleteCountry(f"{iso}: admin {admin} still hits {SLICE_LIMIT} rows")
                bindings.extend(rows)
        except (httpx.HTTPError, IncompleteCountry) as error:
            raise IncompleteCountry(f"{iso}: administrative slicing failed: {error}") from error
    return bindings


def _unmapped_bindings(
    known_qids: set[str],
    *,
    user_agent: str,
    fetch: Callable[..., list[dict]],
) -> list[dict]:
    # Global anti-joins time out on WDQS; enumerate the class ID sets and subtract locally.
    all_qids: set[str] = set()
    try:
        for class_qid in ("Q33506", "Q1007870"):
            rows = fetch(
                f"""SELECT DISTINCT ?m WHERE {{
              ?type wdt:P279* wd:{class_qid} .
              ?m wdt:P31 ?type; wdt:P625 ?coord; wdt:P856 ?website .
            }} LIMIT {MAX_VENUES + 1}""",
                user_agent=user_agent,
            )
            all_qids.update(_qid(row["m"]["value"]) for row in rows)
            if len(all_qids) > MAX_VENUES:
                raise RuntimeError(
                    f"STOP: Wikidata exceeds {MAX_VENUES:,} venues; operator must decide on shards"
                )
        missing = sorted(all_qids - known_qids)
        bindings = []
        for start in range(0, len(missing), 500):
            rows = fetch(
                _venue_query([], None, [], missing[start : start + 500]), user_agent=user_agent
            )
            if _at_limit(rows):
                raise IncompleteCountry("unknown: metadata batch hit the row limit")
            bindings.extend(rows)
        return bindings
    except httpx.HTTPError as error:
        raise IncompleteCountry(f"unknown: global class census failed: {error}") from error


def iter_museums(
    country_qids: Mapping[str, Sequence[str]],
    *,
    user_agent: str,
    metro_admin_qids: Sequence[str] = (),
    known_qids: set[str] | None = None,
    fetch: Callable[..., list[dict]] = sparql,
) -> Iterator[VenueRow]:
    seen: set[str] = set()
    for iso, qids in country_qids.items():
        if not qids:
            if known_qids is None:
                raise ValueError("The unmapped slice requires the completed country census's Q-IDs")
            bindings = _unmapped_bindings(known_qids, user_agent=user_agent, fetch=fetch)
        else:
            bindings = _country_bindings(
                iso,
                qids,
                user_agent=user_agent,
                metro_admin_qids=metro_admin_qids,
                fetch=fetch,
            )
        for venue in parse_venues(bindings, iso):
            if venue.qid not in seen:
                seen.add(venue.qid)
                yield venue


# Wikidata types places unevenly: Amsterdam and Marseille are municipalities but not cities,
# arrondissements, wards and neighborhoods are settlements below the city people name, and urban
# agglomerations (Greater London) and US counties are settlements or municipalities spanning many
# towns.
PLACE_CLASSES = {
    "Q515": "city",
    "Q1549591": "city",  # big city
    "Q5119": "city",  # capital city
    "Q21503295": "city",  # UK district with city status
    "Q15284": "municipality",
    "Q70208": "municipality",  # municipality of Switzerland
    "Q486972": "settlement",
    "Q7930989": "settlement",  # city or town
    "Q1115575": "settlement",  # civil parish of England
    "Q123705": "neighborhood",
    "Q159313": "region",  # urban agglomeration
    "Q47168": "region",  # county of the United States
}
CLIMB_ANCESTORS = 3
ADDRESS_RADIUS_KM = 20
MAX_ADMIN_DEPTH = 10


@dataclass(frozen=True)
class City:
    qid: str
    name: str


def _entity(value: str) -> str | None:
    qid = value.rsplit("/", 1)[-1]
    return qid if re.fullmatch(r"Q[1-9][0-9]*", qid) else None


def _batches[T](items: Iterable[T], size: int) -> list[list[T]]:
    ordered = sorted(items)
    return [ordered[start : start + size] for start in range(0, len(ordered), size)]


def _levels(start: Iterable[str], parents: Mapping[str, Iterable[str]]) -> list[list[str]]:
    levels: list[list[str]] = []
    seen: set[str] = set()
    level = sorted(set(start))
    while level:
        seen.update(level)
        levels.append(level)
        level = sorted({parent for qid in level for parent in parents.get(qid, ())} - seen)
    return levels


def pick_city(
    admins: Iterable[str],
    parents: Mapping[str, Iterable[str]],
    kinds: Mapping[str, frozenset[str]],
) -> str | None:
    def kind(qid: str) -> frozenset[str]:
        return kinds.get(qid, frozenset())

    def locality(qid: str) -> bool:
        types = kind(qid)
        if "region" in types and "city" not in types:
            return False
        return bool(types & {"city", "municipality", "settlement"})

    def rank(qid: str) -> tuple[bool, bool, str]:
        return "city" not in kind(qid), "municipality" not in kind(qid), qid

    candidates = ([qid for qid in level if locality(qid)] for level in _levels(admins, parents))
    nearest = next(filter(None, candidates), None)
    if nearest is None:
        return None
    # Venues listed in both a city and its county, or a village and its city, belong to the city.
    first = min(nearest, key=rank)
    above = [qid for level in _levels(parents.get(first, ()), parents) for qid in level]
    above = above[:CLIMB_ANCESTORS]
    if "city" in kind(first):
        # Boroughs typed as cities (Manhattan) sit directly under the city (New York City).
        return above[0] if above and "city" in kind(above[0]) else first
    wanted = ("city", "municipality") if "neighborhood" in kind(first) else ("city",)
    for target in wanted:
        match = next((qid for qid in above if target in kind(qid)), None)
        if match:
            return match
    return first


@dataclass
class _PlaceGraph:
    user_agent: str
    fetch: Callable[..., list[dict]]
    parents: dict[str, set[str]] = field(default_factory=dict)
    types: dict[str, set[str]] = field(default_factory=dict)
    names: dict[str, dict[str, str]] = field(default_factory=dict)
    type_kinds: dict[str, set[str]] = field(default_factory=dict)
    kinds: dict[str, frozenset[str]] = field(default_factory=dict)

    def expand(self, qids: Iterable[str]) -> None:
        frontier = set(qids)
        for _ in range(MAX_ADMIN_DEPTH):
            frontier -= self.parents.keys()
            if not frontier:
                break
            for batch in _batches(frontier, 300):
                for qid in batch:
                    self.parents[qid], self.types[qid], self.names[qid] = set(), set(), {}
                for row in self.fetch(
                    f"""SELECT ?a ?type ?parent ?en ?mul WHERE {{ VALUES ?a {{ {_values(batch)} }}
                      OPTIONAL {{ ?a wdt:P31 ?type }} OPTIONAL {{ ?a wdt:P131 ?parent }}
                      OPTIONAL {{ ?a rdfs:label ?en . FILTER(LANG(?en) = "en") }}
                      OPTIONAL {{ ?a rdfs:label ?mul . FILTER(LANG(?mul) = "mul") }}
                    }}""",
                    user_agent=self.user_agent,
                ):
                    qid = _qid(row["a"]["value"])
                    for key, target in (("type", self.types), ("parent", self.parents)):
                        if key in row and (value := _entity(row[key]["value"])):
                            target[qid].add(value)
                    for language in ("en", "mul"):
                        if language in row:
                            self.names[qid][language] = row[language]["value"]
            frontier = {parent for qid in frontier for parent in self.parents[qid]}
        unclassified = {t for ts in self.types.values() for t in ts} - self.type_kinds.keys()
        for batch in _batches(unclassified, 200):
            for qid in batch:
                self.type_kinds[qid] = set()
            for row in self.fetch(
                f"""SELECT ?type ?class WHERE {{ VALUES ?type {{ {_values(batch)} }}
                  VALUES ?class {{ {_values(PLACE_CLASSES)} }} ?type wdt:P279* ?class }}""",
                user_agent=self.user_agent,
            ):
                self.type_kinds[_qid(row["type"]["value"])].add(
                    PLACE_CLASSES[_qid(row["class"]["value"])]
                )
        self.kinds = {
            qid: frozenset(kind for t in ts for kind in self.type_kinds[t])
            for qid, ts in self.types.items()
        }

    def city(self, admins: Iterable[str]) -> City | None:
        qid = pick_city(admins, self.parents, self.kinds)
        label = qid and (self.names[qid].get("en") or self.names[qid].get("mul"))
        # English labels name Nordic, Greek and Balkan municipalities "Bergen Municipality".
        return City(qid, label.removesuffix(" Municipality")) if qid and label else None


def address_names(address: str) -> set[str]:
    """Candidate place names: runs of up to four words between punctuation and digit-bearing
    tokens (house numbers, postcodes), e.g. "Suisun City" in "5848 State Highway 12 Suisun City"."""
    names = set()
    for segment in re.split(r"[,;/.()\n]", address):
        for run in re.split(r"\S*\d\S*", segment):
            words = run.split()
            for start in range(len(words)):
                for end in range(start + 1, min(len(words), start + 4) + 1):
                    name = " ".join(words[start:end])
                    if not name[0].islower():
                        names.add(name)
    return names


def _nearby_places(
    venue_qids: Iterable[str], *, user_agent: str, fetch: Callable[..., list[dict]]
) -> dict[str, list[str]]:
    points: dict[str, tuple[float, float]] = {}
    locations: dict[str, set[str]] = {}
    labels: dict[str, set[tuple[str, str]]] = {}
    for batch in _batches(venue_qids, 500):
        for row in fetch(
            f"""SELECT ?m ?coord ?location ?address WHERE {{ VALUES ?m {{ {_values(batch)} }}
              ?m wdt:P625 ?coord .
              OPTIONAL {{ ?m wdt:P276 ?location }} OPTIONAL {{ ?m wdt:P6375 ?address }}
            }}""",
            user_agent=user_agent,
        ):
            venue = _qid(row["m"]["value"])
            if point := _point(row["coord"]["value"]):
                points.setdefault(venue, point)
            if "location" in row and (location := _entity(row["location"]["value"])):
                locations.setdefault(venue, set()).add(location)
            if "address" in row:
                language = row["address"].get("xml:lang", "en").split("-")[0]
                languages = {"en", "mul"} | (
                    {language} if re.fullmatch(r"[a-z]{2,3}", language) else set()
                )
                labels.setdefault(venue, set()).update(
                    (name, lang)
                    for name in address_names(row["address"]["value"])
                    for lang in languages
                )
    matches: dict[tuple[str, str], set[tuple[str, tuple[float, float]]]] = {}
    for batch in _batches({label for values in labels.values() for label in values}, 500):
        literals = " ".join(
            f"{json.dumps(name, ensure_ascii=False)}@{lang}" for name, lang in batch
        )
        for row in fetch(
            f"""SELECT ?label ?place ?coord WHERE {{ VALUES ?label {{ {literals} }}
              ?place rdfs:label ?label ; wdt:P625 ?coord . }}""",
            user_agent=user_agent,
        ):
            place, point = _entity(row["place"]["value"]), _point(row["coord"]["value"])
            if place and point:
                label = (row["label"]["value"], row["label"]["xml:lang"])
                matches.setdefault(label, set()).add((place, point))
    nearby = {}
    for venue, point in points.items():
        near = sorted(
            (distance_km(*point, place_point), place)
            for label in labels.get(venue, ())
            for place, place_point in matches.get(label, ())
        )
        nearby[venue] = sorted(locations.get(venue, ())) + [
            place for distance, place in near if distance <= ADDRESS_RADIUS_KM
        ]
    return nearby


def resolve_cities(
    venue_qids: Iterable[str],
    *,
    user_agent: str,
    fetch: Callable[..., list[dict]] = sparql,
) -> dict[str, City]:
    venues = set(venue_qids)
    direct: dict[str, set[str]] = {}
    for batch in _batches(venues, 500):
        for row in fetch(
            f"SELECT ?m ?admin WHERE {{ VALUES ?m {{ {_values(batch)} }} ?m wdt:P131 ?admin }}",
            user_agent=user_agent,
        ):
            if admin := _entity(row["admin"]["value"]):
                direct.setdefault(_qid(row["m"]["value"]), set()).add(admin)
    graph = _PlaceGraph(user_agent, fetch)
    graph.expand(admin for admins in direct.values() for admin in admins)
    cities = {venue: city for venue, admins in direct.items() if (city := graph.city(admins))}
    from_admins = len(cities)
    # Without an administrative chain, fall back to the venue's location and the places named in
    # its street address that lie near it.
    nearby = _nearby_places(venues - cities.keys(), user_agent=user_agent, fetch=fetch)
    graph.expand(place for places in nearby.values() for place in places)
    for venue, places in nearby.items():
        found = [city for place in places if (city := graph.city([place]))]
        if found:
            # "Canonbury Square, London" names a neighborhood and its city; the city wins.
            cities[venue] = min(found, key=lambda city: "city" not in graph.kinds[city.qid])
    log.info(
        "Resolved cities for %d of %d venues (%d from location or address)",
        len(cities),
        len(venues),
        len(cities) - from_admins,
    )
    return cities
