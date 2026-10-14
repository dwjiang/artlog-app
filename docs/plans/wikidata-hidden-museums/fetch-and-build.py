#!/usr/bin/env python3
"""Enumerate Wikidata museums and galleries missing from a prod museum snapshot and build hidden museum rows.

Stdlib only. Run from the repository root. Reads repo config; writes only inside --work.
Resumable: enumeration CSVs and fetched entities are cached in --work.
"""

import argparse
import collections
import json
import math
import pathlib
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

USER_AGENT = "artlog-bot/0.1 (+https://github.com/dwjiang/artlog-app)"
CLASSES = {"museum": "Q33506", "art_gallery": "Q1007870", "art_museum": "Q207694"}
METRO_RADIUS_KM = 100  # must equal scripts/data/pipeline/regions.py
EARTH = "http://www.wikidata.org/entity/Q2"

REPO = pathlib.Path.cwd()
for required in ("shared/sources/regions.json", "shared/journal/countries.json", "scripts/data/config/countries.json"):
    if not (REPO / required).exists():
        sys.exit(f"STOP: run from the repository root ({required} not found)")
if f"METRO_RADIUS_KM = {METRO_RADIUS_KM}" not in (REPO / "scripts/data/pipeline/regions.py").read_text():
    sys.exit("STOP: scripts/data/pipeline/regions.py metro radius changed; update METRO_RADIUS_KM and region_for")

REGIONS = json.loads((REPO / "shared/sources/regions.json").read_text())
VALID_ISO = set(json.loads((REPO / "shared/journal/countries.json").read_text()))
ISO_BY_COUNTRY_QID = {
    qid: iso for iso, qids in json.loads((REPO / "scripts/data/config/countries.json").read_text()).items() for qid in qids
}


def get_json(url: str, params: dict) -> dict:
    request = urllib.request.Request(url + "?" + urllib.parse.urlencode(params), headers={"User-Agent": USER_AGENT})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                return json.load(response)
        except Exception as error:  # noqa: BLE001 - transient network/HTTP errors; retried then fatal
            wait = 5 * (attempt + 1)
            print(f"retry {attempt + 1} in {wait}s: {error}", flush=True)
            time.sleep(wait)
    sys.exit("STOP: Wikidata request kept failing")


def enumerate_class(work: pathlib.Path, name: str, qid: str) -> set[str]:
    cache = work / f"enum-{name}.json"
    if cache.exists():
        return set(json.loads(cache.read_text()))
    query = f"SELECT DISTINCT ?m WHERE {{ ?type wdt:P279* wd:{qid} . ?m wdt:P31 ?type; wdt:P625 ?c . }}"
    data = get_json("https://query.wikidata.org/sparql", {"query": query, "format": "json"})
    qids = sorted({row["m"]["value"].rsplit("/", 1)[-1] for row in data["results"]["bindings"]})
    qids = [q for q in qids if re.fullmatch(r"Q[1-9][0-9]*", q)]
    cache.write_text(json.dumps(qids))
    return set(qids)


def fetch_entities(work: pathlib.Path, qids: list[str]) -> dict:
    cache = work / "entities.jsonl"
    entities = {}
    if cache.exists():
        for line in cache.read_text().splitlines():
            record = json.loads(line)
            entities[record["requested"]] = record["entity"]
    todo = [q for q in qids if q not in entities]
    with cache.open("a") as out:
        for start in range(0, len(todo), 50):
            batch = todo[start : start + 50]
            data = get_json(
                "https://www.wikidata.org/w/api.php",
                {"action": "wbgetentities", "ids": "|".join(batch), "props": "claims|labels", "format": "json"},
            )
            if "error" in data:
                sys.exit(f"STOP: wbgetentities error {data['error']}")
            returned = data.get("entities", {})
            for requested in batch:
                # A redirected item comes back under its target id; record it so it can be skipped as a duplicate.
                entity = returned.get(requested)
                if entity is None:
                    entity = next((e for e in returned.values() if e.get("redirects", {}).get("from") == requested), None)
                entity = entity or {"missing": ""}
                entities[requested] = entity
                out.write(json.dumps({"requested": requested, "entity": entity}, ensure_ascii=False) + "\n")
            out.flush()
            print(f"entities {min(start + 50, len(todo))}/{len(todo)}", flush=True)
            time.sleep(1)
    return entities


def best(claims: dict, prop: str) -> list[dict]:
    values = [s for s in claims.get(prop, []) if s.get("mainsnak", {}).get("snaktype") == "value"]
    return [s for s in values if s.get("rank") == "preferred"] or [s for s in values if s.get("rank") == "normal"]


def distance_km(lat: float, lng: float, center) -> float:
    lat1, lat2 = math.radians(lat), math.radians(center[0])
    dlat, dlng = lat2 - lat1, math.radians(center[1] - lng)
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(min(1, max(0, a))))


def region_for(lat: float, lng: float, country_iso: str, admins: set[str]) -> str:
    # Copy of scripts/data/pipeline/regions.py region_for.
    candidates = []
    for key, region in REGIONS.items():
        if "center" not in region or region.get("country") != country_iso:
            continue
        distance = distance_km(lat, lng, region["center"])
        admin_match = bool(admins & set(region.get("adminQids", [])))
        if admin_match or distance <= METRO_RADIUS_KM:
            candidates.append((not admin_match, distance, key))
    return min(candidates)[2] if candidates else f"country:{country_iso}"


def normalized(name: str) -> str:
    return unicodedata.normalize("NFKC", name).strip().casefold()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--work", type=pathlib.Path, required=True)
    parser.add_argument("--prod-snapshot", type=pathlib.Path, required=True)
    parser.add_argument("--limit", type=int, help="Only process the first N new QIDs (smoke test)")
    args = parser.parse_args()
    args.work.mkdir(parents=True, exist_ok=True)

    prod = json.loads(args.prod_snapshot.read_text())
    prod_qids = {row["wikidataId"] for row in prod if row.get("wikidataId")}
    prod_keys = {row["key"] for row in prod}
    by_name = collections.defaultdict(list)
    for row in prod:
        by_name[normalized(row["name"])].append(row)

    museums = enumerate_class(args.work, "museum", CLASSES["museum"])
    galleries = enumerate_class(args.work, "art_gallery", CLASSES["art_gallery"])
    art_museums = enumerate_class(args.work, "art_museum", CLASSES["art_museum"])
    likely_art = galleries | art_museums
    new_qids = sorted((museums | galleries) - prod_qids, key=lambda q: int(q[1:]))
    if args.limit:
        new_qids = new_qids[: args.limit]
    entities = fetch_entities(args.work, new_qids)

    rows, skipped = [], collections.defaultdict(list)
    for qid in new_qids:
        entity = entities[qid]
        if "missing" in entity:
            skipped["missing_entity"].append(qid)
            continue
        if entity.get("id") != qid:
            skipped["redirected"].append({"qid": qid, "target": entity.get("id")})
            continue
        if f"wikidata:{qid}" in prod_keys:
            skipped["key_in_prod"].append(qid)
            continue
        claims = entity.get("claims", {})
        coords = best(claims, "P625")
        point = coords[0]["mainsnak"]["datavalue"]["value"] if coords else None
        if not point or point.get("globe") != EARTH:
            skipped["no_earth_coordinates"].append(qid)
            continue
        lat, lng = point["latitude"], point["longitude"]
        if not (math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180):
            skipped["invalid_coordinates"].append(qid)
            continue
        labels = entity.get("labels", {})
        label = labels.get("en") or labels.get("mul") or (labels[sorted(labels)[0]] if labels else None)
        name = (label or {}).get("value", "").strip()
        if not name or len(name) > 300:
            skipped["no_usable_label"].append(qid)
            continue
        isos = {ISO_BY_COUNTRY_QID.get(s["mainsnak"]["datavalue"]["value"]["id"]) for s in best(claims, "P17")} - {None}
        country = isos.pop() if len(isos) == 1 else None
        if country not in VALID_ISO:
            country = None
        admins = {
            s["mainsnak"]["datavalue"]["value"]["id"]
            for s in claims.get("P131", [])
            if s.get("mainsnak", {}).get("snaktype") == "value" and s.get("rank") != "deprecated"
        }
        websites = [s["mainsnak"]["datavalue"]["value"] for s in best(claims, "P856")]
        website = next((w for w in websites if isinstance(w, str) and w.startswith(("http://", "https://"))), None)
        clash = [p["key"] for p in by_name[normalized(name)] if distance_km(lat, lng, [p["lat"], p["lng"]]) <= 1]
        if clash:
            skipped["same_named_prod_venue_within_1km"].append({"qid": qid, "name": name, "existing": clash})
            continue
        rows.append(
            {
                "key": f"wikidata:{qid}",
                "wikidataId": qid,
                "name": name,
                "lat": lat,
                "lng": lng,
                "region": region_for(lat, lng, country or "unknown", admins),
                "seedSource": "wikidata",
                **({"country": country} if country else {}),
                **({"website": website} if website else {}),
            }
        )

    # Same-named new rows within 1 km are most likely one place under two items; keep the lowest QID.
    kept, seen = [], collections.defaultdict(list)
    for row in rows:
        twin = next(
            (k for k in seen[normalized(row["name"])] if distance_km(row["lat"], row["lng"], [k["lat"], k["lng"]]) <= 1),
            None,
        )
        if twin:
            skipped["same_named_new_venue_within_1km"].append({"qid": row["wikidataId"], "keptQid": twin["wikidataId"]})
            continue
        seen[normalized(row["name"])].append(row)
        kept.append(row)

    (args.work / "rows.json").write_text(json.dumps(kept, ensure_ascii=False, indent=1))
    (args.work / "skipped.json").write_text(json.dumps(skipped, ensure_ascii=False, indent=1))
    (args.work / "likely-art.json").write_text(json.dumps(sorted(r["wikidataId"] for r in kept if r["wikidataId"] in likely_art)))
    summary = {
        "prodSnapshotRows": len(prod),
        "wikidataMuseumsAndGalleries": len(museums | galleries),
        "newQids": len(new_qids),
        "rows": len(kept),
        "likelyArtRows": sum(r["wikidataId"] in likely_art for r in kept),
        "withCountry": sum("country" in r for r in kept),
        "withWebsite": sum("website" in r for r in kept),
        "skipped": {key: len(value) for key, value in skipped.items()},
    }
    (args.work / "build-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
