import argparse
import hashlib
import json
from urllib.parse import urlencode

from probe import ROOT, Probe, now, save

PREFIX = """PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX ps: <http://www.wikidata.org/prop/statement/>
PREFIX pq: <http://www.wikidata.org/prop/qualifier/>
"""
PAINTINGS = "?item wdt:P31 wd:Q3305213; wdt:P18 ?image ."
QUERIES = {
    "paintings_with_image": PAINTINGS,
    "paintings_location_differs_collection": PAINTINGS + """
      FILTER EXISTS { ?item wdt:P276 ?location; wdt:P195 ?owner . FILTER(?location != ?owner) }""",
    "paintings_direct_accession": PAINTINGS + " FILTER EXISTS { ?item wdt:P217 ?accession }",
    "paintings_collection_accession": PAINTINGS + """
      FILTER EXISTS { ?item p:P195 ?statement . ?statement ps:P195 ?owner; pq:P217 ?accession }""",
    "paintings_either_accession": PAINTINGS + """
      FILTER(EXISTS { ?item wdt:P217 ?accession } ||
        EXISTS { ?item p:P195 ?statement . ?statement ps:P195 ?owner; pq:P217 ?accession })""",
    "paintings_copyright_status": PAINTINGS + " FILTER EXISTS { ?item wdt:P6216 ?status }",
    "paintings_creator_death": PAINTINGS + " FILTER EXISTS { ?item wdt:P170/wdt:P570 ?death }",
    "paintings_copyright_or_creator_death": PAINTINGS + """
      FILTER(EXISTS { ?item wdt:P6216 ?status } || EXISTS { ?item wdt:P170/wdt:P570 ?death })""",
    "venues_coordinates_website": """
      VALUES ?class { wd:Q33506 wd:Q1007870 }
      ?item wdt:P31/wdt:P279* ?class; wdt:P625 ?coord; wdt:P856 ?website .""",
}


def count_venues_by_class(probe, output):
    sets = []
    output["venue_class_slices"] = {}
    for class_id in ["Q33506", "Q1007870"]:
        query = PREFIX + f"""SELECT DISTINCT ?item WHERE {{
          ?type wdt:P279* wd:{class_id} .
          ?item wdt:P31 ?type; wdt:P625 ?coord; wdt:P856 ?website .
        }}"""
        record, data = probe.json(output["endpoint"] + "?" + urlencode({"query": query, "format": "json"}))
        ids = sorted({row["item"]["value"].rsplit("/", 1)[-1] for row in data["results"]["bindings"]}) if data else None
        output["venue_class_slices"][class_id] = {"query": query, "count": len(ids) if ids is not None else None, "request": record}
        if ids is not None:
            sets.append(set(ids))
        save("wikidata", output)
    if len(sets) == 2:
        ids = sorted(sets[0] | sets[1])
        output["venue_union"] = {"count": len(ids), "overlap": len(sets[0] & sets[1]), "ids_sha256": hashlib.sha256("\n".join(ids).encode()).hexdigest(), "estimated_bytes_at_120_per_row": 120 * len(ids)}
    else:
        output["venue_union"] = {"count": None, "reason": "One or both class queries failed; partial counts are not a total."}
    save("wikidata", output)


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument("--venues-only", action="store_true", help="Retry venue class slices, preserving previous painting observations.")
    args = parser.parse_args()
    probe = Probe(interval=2)
    if args.venues_only:
        count_venues_by_class(probe, json.loads((ROOT / "results/wikidata.json").read_text()))
        return
    output = {"started_at": now(), "endpoint": "https://query.wikidata.org/sparql", "queries": {}}
    for name, body in QUERIES.items():
        query = PREFIX + "SELECT (COUNT(DISTINCT ?item) AS ?count) WHERE { " + body + " }"
        record, data = probe.json(output["endpoint"] + "?" + urlencode({"query": query, "format": "json"}))
        bindings = data.get("results", {}).get("bindings", []) if data else []
        count = int(bindings[0]["count"]["value"]) if bindings else None
        output["queries"][name] = {"query": query, "count": count, "request": record}
        save("wikidata", output)
        if name == "paintings_with_image" and count is None:
            for creator in ["Q5582", "Q5598"]:
                sliced = PREFIX + "SELECT (COUNT(DISTINCT ?item) AS ?count) WHERE { " + PAINTINGS + f" ?item wdt:P170 wd:{creator} . }}"
                request, result = probe.json(output["endpoint"] + "?" + urlencode({"query": sliced, "format": "json"}))
                output["queries"][f"creator_slice_{creator}"] = {"query": sliced, "response": result, "request": request}
            if all(output["queries"][f"creator_slice_{creator}"]["response"] is None for creator in ["Q5582", "Q5598"]):
                output["painting_stop"] = "Full count and both creator slices failed. Remaining painting queries not sent; no dump estimate without a measured dump."
                save("wikidata", output)
                # The independent venue query is still useful.
                for skipped in list(QUERIES)[1:-1]:
                    output["queries"][skipped] = {"query": PREFIX + "SELECT (COUNT(DISTINCT ?item) AS ?count) WHERE { " + QUERIES[skipped] + " }", "count": None, "reason": output["painting_stop"]}
                break
    if "venues_coordinates_website" not in output["queries"]:
        query = PREFIX + "SELECT (COUNT(DISTINCT ?item) AS ?count) WHERE { " + QUERIES["venues_coordinates_website"] + " }"
        record, data = probe.json(output["endpoint"] + "?" + urlencode({"query": query, "format": "json"}))
        output["queries"]["venues_coordinates_website"] = {"query": query, "response": data, "request": record}
    if output["queries"]["venues_coordinates_website"].get("count") is None:
        count_venues_by_class(probe, output)
    save("wikidata", output)


if __name__ == "__main__":
    run()
