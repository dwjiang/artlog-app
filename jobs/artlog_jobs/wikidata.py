import logging
import math
import re
import threading
import time
from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass
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


def parse_venues(bindings: list[dict], country_iso: str) -> list[VenueRow]:
    venues: dict[str, VenueRow] = {}
    for binding in bindings:
        value = {key: entry["value"] for key, entry in binding.items()}
        coord = re.fullmatch(r"Point\(([-+\d.eE]+) ([-+\d.eE]+)\)", value.get("coord", ""))
        if coord is None or not value.get("website"):
            continue
        lng, lat = map(float, coord.groups())
        if not (
            math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180
        ):
            continue
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
