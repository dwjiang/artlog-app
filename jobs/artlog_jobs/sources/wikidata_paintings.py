import hashlib
import json
import logging
from collections import Counter, defaultdict
from collections.abc import Callable
from pathlib import Path

import httpx

from ..wikidata import sparql
from .fetch import write_json

log = logging.getLogger(__name__)
ANONYMOUS_CREATOR_ID = "Q4233718"
CENSUS_QUERY = """SELECT DISTINCT ?item ?collection WHERE {
  ?item wdt:P31 wd:Q3305213; wdt:P18 ?image .
  OPTIONAL { ?item wdt:P195 ?collection . FILTER(ISIRI(?collection)) }
}"""


def metadata_query(qids: list[str]) -> str:
    from ..wikidata import _values

    return f"""SELECT ?item ?itemLabel ?image ?artist ?artistLabel ?death ?inception
      ?location ?copyright ?collection ?accession ?directAccession ?series ?versionOf WHERE {{
      VALUES ?item {{ {_values(qids)} }}
      ?item wdt:P31 wd:Q3305213; wdt:P18 ?image .
      OPTIONAL {{ ?item wdt:P170 ?artist . OPTIONAL {{ ?artist wdt:P570 ?death }} }}
      OPTIONAL {{ ?item wdt:P571 ?inception }}
      OPTIONAL {{ ?item wdt:P276 ?location }}
      OPTIONAL {{ ?item wdt:P6216 ?copyright }}
      OPTIONAL {{
        ?item p:P195 ?statement . ?statement ps:P195 ?collection .
        FILTER NOT EXISTS {{ ?statement wikibase:rank wikibase:DeprecatedRank }}
        FILTER NOT EXISTS {{ ?statement pq:P582 ?ended }}
        OPTIONAL {{ ?statement pq:P217 ?accession }}
      }}
      OPTIONAL {{ ?item wdt:P217 ?directAccession }}
      OPTIONAL {{ ?item wdt:P179 ?series }}
      OPTIONAL {{ ?item wdt:P144 ?versionOf }}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en,mul,fr,de,es,it". }}
    }}"""


def _timeout(error: Exception) -> bool:
    return isinstance(error, (httpx.TimeoutException, json.JSONDecodeError)) or (
        isinstance(error, httpx.HTTPStatusError)
        and error.response.status_code in (500, 502, 503, 504)
    )


def fetch_paintings(
    out: Path, *, user_agent: str, fetch: Callable = sparql, batch_size: int = 500
) -> dict:
    if batch_size <= 0:
        raise ValueError("batch_size must be positive")
    out.mkdir(parents=True, exist_ok=True)
    census_path = out / "census.json"
    if census_path.exists():
        census = json.loads(census_path.read_text())
    else:
        census = fetch(CENSUS_QUERY, user_agent=user_agent)
        write_json(census_path, census)
    owners: dict[str, set[str]] = defaultdict(set)
    for row in census:
        qid = row["item"]["value"].rsplit("/", 1)[-1]
        if "collection" in row:
            collection = row["collection"]["value"].rsplit("/", 1)[-1]
            owners[qid].add(collection)
        else:
            owners[qid]
    if not owners:
        raise RuntimeError("Wikidata returned an empty painting census")
    counts = Counter(collection for values in owners.values() for collection in values)
    top = {collection for collection, _ in counts.most_common(200)}
    groups = defaultdict(list)
    for qid, collections in sorted(owners.items()):
        candidates = collections & top
        group = min(candidates, key=lambda key: (-counts[key], key)) if candidates else "remainder"
        groups[group].append(qid)
    completed, failed, files = set(), [], []

    def run_slice(name: str, qids: list[str], *, decade: bool = False) -> None:
        digest = hashlib.sha256("\n".join(qids).encode()).hexdigest()[:16]
        path = out / f"paintings-{name}-{digest}.json"
        pending = qids
        try:
            rows = json.loads(path.read_text())["results"]["bindings"] if path.exists() else []
            actual = {row["item"]["value"].rsplit("/", 1)[-1] for row in rows}
            completed.update(actual & set(qids))
            if rows:
                files.append(path.name)
            pending = sorted(set(qids) - actual)
            if pending:
                rows += fetch(metadata_query(pending), user_agent=user_agent)
                write_json(path, {"results": {"bindings": rows}})
            actual = {row["item"]["value"].rsplit("/", 1)[-1] for row in rows}
            completed.update(actual & set(qids))
            missing = set(qids) - actual
            if missing:
                failed.append(
                    {
                        "slice": name,
                        "items": sorted(missing),
                        "reason": "absent from metadata response",
                    }
                )
            files.append(path.name)
            log.info(
                "Wikidata %s: %d/%d items, %d bytes",
                name,
                len(completed),
                len(owners),
                path.stat().st_size,
            )
        except Exception as error:
            if not _timeout(error):
                raise
            if decade:
                failed.append({"slice": name, "items": pending, "reason": str(error)})
                log.error(
                    "STOP slice %s: collection + decade slicing timed out; retaining partial coverage",
                    name,
                )
                return
            from ..wikidata import _values

            try:
                deaths = fetch(
                    f"""SELECT ?item ?death WHERE {{
                  VALUES ?item {{ {_values(pending)} }}
                  OPTIONAL {{ ?item wdt:P170/wdt:P570 ?death }}
                }}""",
                    user_agent=user_agent,
                )
            except Exception as error:
                if not _timeout(error):
                    raise
                failed.append(
                    {"slice": name, "items": pending, "reason": "death-decade lookup timed out"}
                )
                return
            decades = defaultdict(list)
            by_item = defaultdict(list)
            for row in deaths:
                if "death" in row:
                    year = (
                        int(row["death"]["value"].split("-", 1)[0])
                        if not row["death"]["value"].startswith("-")
                        else None
                    )
                    if year is not None:
                        by_item[row["item"]["value"].rsplit("/", 1)[-1]].append(year)
            for qid in pending:
                years = by_item[qid]
                decades[str(max(years) // 10 * 10) if years else "unknown"].append(qid)
            for dec, subset in sorted(decades.items()):
                run_slice(f"{name}-death-{dec}", subset, decade=True)

    for group, ids in sorted(groups.items()):
        for start in range(0, len(ids), batch_size):
            run_slice(f"{group}-{start:06d}", ids[start : start + batch_size])
    result = {
        "censusItems": len(owners),
        "items": len(completed),
        "complete": len(completed) == len(owners),
        "missingItems": sorted(set(owners) - completed),
        "failedSlices": failed,
        "files": sorted(set(files)),
    }
    write_json(out / "stats.json", result)
    return result


def iter_records(bindings, *, owners, current_year=None):
    from urllib.parse import quote, unquote, urlsplit

    from ..normalize import ArtworkRecord, ObjectRecord, PlacementRecord, clean, qid, year
    from ..rights import from_wikidata

    grouped = defaultdict(list)
    unknown = defaultdict(set)
    for binding in bindings:
        unknown_fields = {
            key
            for key, entry in binding.items()
            if entry.get("type") == "bnode" or "/.well-known/genid/" in entry["value"]
        }
        if qid(binding.get("artist", {}).get("value")) == ANONYMOUS_CREATOR_ID:
            unknown_fields.add("artist")
        if "artist" in unknown_fields:
            unknown_fields.add("artistLabel")
        values = {
            key: entry["value"] for key, entry in binding.items() if key not in unknown_fields
        }
        entity = qid(values.get("item"))
        if entity:
            grouped[entity].append(values)
            unknown[entity].update(unknown_fields)
    for entity, rows in sorted(grouped.items()):

        def values(field, data=rows):
            return sorted({clean(row[field]) for row in data if clean(row.get(field))})

        images = values("image")
        if not images:
            continue
        key = f"wikidata:{entity}"
        artists = sorted({value for value in values("artist") if qid(value)})
        deaths = []
        for artist in artists:
            dates = {year(row.get("death")) for row in rows if row.get("artist") == artist}
            deaths.append(max((date for date in dates if date is not None), default=None))
        if "artist" in unknown[entity] or "death" in unknown[entity]:
            deaths.append(None)
        statuses = [qid(value) or "unknown" for value in values("copyright")]
        if "copyright" in unknown[entity]:
            statuses.append("unknown")
        rights = from_wikidata(statuses, deaths, current_year=current_year)
        collections = sorted({value for value in values("collection") if qid(value)})
        mapped = {value: owners.venue(value, owner=True) for value in collections}
        # Multiple collection claims do not establish a single owner; do not pick one arbitrarily.
        collection = (
            collections[0]
            if len(collections) == 1 and "collection" not in unknown[entity]
            else None
        )
        owner = mapped.get(collection)
        accessions = (
            sorted(
                {
                    row["accession"]
                    for row in rows
                    if row.get("accession") and row.get("collection") == collection
                }
            )
            if collection
            else []
        )
        if not accessions:
            accessions = values("directAccession")
        accession = accessions[0] if len(accessions) == 1 else None
        locations = sorted({value for value in values("location") if qid(value)})
        ambiguous_location = len(locations) > 1 or bool(locations and "location" in unknown[entity])
        location = (
            owners.venue(locations[0]) if len(locations) == 1 and not ambiguous_location else None
        )
        venue = location or (owner if not ambiguous_location else None)
        inceptions = values("inception")
        years = [date for date in (year(value) for value in inceptions) if date is not None]
        series = sorted({series_id for value in values("series") if (series_id := qid(value))})
        artist_labels = values("artistLabel")
        if "artist" in unknown[entity]:
            artist_labels = sorted(set(artist_labels) | {"Unknown artist"})
        artwork = ArtworkRecord(
            key=key,
            wikidataId=entity,
            title=next(iter(values("itemLabel")), entity),
            artist="; ".join(artist_labels) or "Unknown artist",
            artistId=qid(artists[0])
            if len(artists) == 1 and "artist" not in unknown[entity]
            else None,
            date=str(min(years)) if years else None,
            yearStart=min(years) if years else None,
            yearEnd=max(years) if years else None,
            rightsStatus=rights,
            seriesId=f"wikidata:{series[0]}" if len(series) == 1 else None,
        )
        parsed = urlsplit(images[0])
        if (
            parsed.hostname not in ("commons.wikimedia.org", "www.commons.wikimedia.org")
            or "/Special:FilePath/" not in parsed.path
        ):
            raise ValueError(f"Unexpected Wikidata P18 URL: {images[0]}")
        filename = unquote(parsed.path.split("/Special:FilePath/", 1)[1])
        image_ref = "https://commons.wikimedia.org/wiki/Special:FilePath/" + quote(
            filename, safe=""
        )
        obj = ObjectRecord(
            key=key,
            artworkKey=key,
            ownerKey=owner,
            accession=accession,
            sourceId=entity,
            imageRef=image_ref,
            thumbnailUrl=image_ref + "?width=330" if rights == "public_domain" else None,
            pageUrl=f"https://www.wikidata.org/wiki/{entity}",
        )
        placement = (
            PlacementRecord(
                objectKey=key,
                venueKey=venue,
                onView=False,
                source="wikidata",
                confidence=0.6 if location else 0.5,
            )
            if venue
            else None
        )
        yield artwork, obj, placement
