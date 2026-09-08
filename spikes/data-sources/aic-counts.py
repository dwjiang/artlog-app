import json
from urllib.parse import urlencode

from probe import Probe, now, save

BASE = "https://api.artic.edu/api/v1"
FIELDS = "id,title,artwork_type_title,artwork_type_id,image_id,is_public_domain,is_on_view,gallery_title,copyright_notice,main_reference_number"
COUNT_FILTERS = {
    "paintings": [],
    "paintings_with_image": [{"exists": {"field": "image_id"}}],
    "paintings_with_image_public_domain": [{"exists": {"field": "image_id"}}, {"term": {"is_public_domain": True}}],
    "paintings_with_image_on_view": [{"exists": {"field": "image_id"}}, {"term": {"is_on_view": True}}],
    "paintings_with_image_public_domain_on_view": [{"exists": {"field": "image_id"}}, {"term": {"is_public_domain": True}}, {"term": {"is_on_view": True}}],
}


def run():
    probe = Probe()
    headers = {"AIC-User-Agent": "artlog (+https://github.com/dwjiang/artlog-app)"}
    output = {"started_at": now(), "counts": {}, "samples": {}}
    _, types = probe.json(BASE + "/artwork-types?limit=100", headers=headers)
    output["artwork_types"] = types
    painting = next((row for row in types.get("data", []) if row["title"] == "Painting"), None) if types else None
    if painting is None:
        reason = "Painting type discovery failed; dependent counts were not queried."
        output["counts"] = {name: {"count": None, "reason": reason} for name in COUNT_FILTERS}
        output["requests"] = probe.records
        save("aic", output)
        return
    filters = [{"term": {"artwork_type_id": painting["id"]}}]
    for name, clauses in COUNT_FILTERS.items():
        params = {"query": {"bool": {"filter": filters + clauses}}, "limit": 0}
        record, data = probe.json(BASE + "/artworks/search?" + urlencode({"params": json.dumps(params)}), headers=headers)
        output["counts"][name] = {"params": params, "count": data["pagination"]["total"] if data else None, "request": record}
    for label, object_id in [("public_domain", 27992)]:
        _, data = probe.json(BASE + f"/artworks/{object_id}?fields={FIELDS}", headers=headers)
        output["samples"][label] = data
    params = {"query": {"bool": {"filter": filters + [{"term": {"is_public_domain": False}}, {"exists": {"field": "copyright_notice"}}]}}, "limit": 3, "fields": FIELDS.split(",")}
    _, data = probe.json(BASE + "/artworks/search?" + urlencode({"params": json.dumps(params)}), headers=headers)
    output["samples"]["copyright"] = data
    _, listing = probe.json(BASE + "/artworks?limit=1&fields=id", headers=headers)
    output["listing_total"] = listing["pagination"]["total"] if listing else None
    _, releases = probe.json("https://api.github.com/repos/art-institute-of-chicago/api-data/releases/latest")
    output["dump_release"] = ({"url": releases.get("html_url"), "published_at": releases.get("published_at"), "assets": [{"name": a["name"], "bytes": a["size"], "url": a["browser_download_url"]} for a in releases.get("assets", [])]} if releases else None)
    dump, _ = probe.request("https://artic-api-data.s3.amazonaws.com/artic-api-data.tar.bz2", method="HEAD")
    output["dump"] = dump
    output["requests"] = probe.records
    save("aic", output)


if __name__ == "__main__":
    run()
