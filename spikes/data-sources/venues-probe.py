import json
import xml.etree.ElementTree as ET

from protego import Protego

from probe import BROWSER_UA, ROOT, UA, Probe, now, save
from robots import robots_policy


def sitemap_summary(record, body):
    if record["status"] != 200 or record.get("truncated"):
        return {"kind": "unknown", "reason": "non-200 or body exceeds probe cap"}
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return {"kind": "unknown", "reason": "not XML"}
    kind = root.tag.split("}")[-1]
    if kind not in ("urlset", "sitemapindex"):
        return {"kind": "unknown", "reason": "not a sitemap"}
    locations = [node.text for node in root.iter() if node.tag.split("}")[-1] == "loc"]
    return {"kind": kind, "locations_count": len(locations), "sample_locations": locations[:10]}


def run():
    output = {"started_at": now(), "object_pages_fetched": 0, "profiles": []}
    for venue in json.loads((ROOT / "venues.json").read_text()):
        probe = Probe()
        profile = {**venue, "robots": {}}
        for label, ua in [("polite", UA), ("browser", BROWSER_UA)]:
            record, body = probe.request(venue["origin"] + "/robots.txt", ua=ua, max_bytes=512_000)
            policy = robots_policy(record, body, venue["origin"] + venue["collectionPath"])
            profile["robots"][label] = {"request": record, "policy": policy, "body": body if policy["verdict"] == "parsed" else None}
            probe.interval = max(probe.interval, policy.get("crawl_delay") or 0)
        polite = profile["robots"]["polite"]
        if polite["policy"]["verdict"] not in ("parsed", "not_present"):
            profile["remaining_probes"] = "Skipped: polite robots request unavailable or blocked; browser response never unlocks access."
        else:
            rules = Protego.parse(polite["body"] or "")
            # Policy metadata only: no collection or object pages, including for excluded venues.
            for path in ["/.well-known/tdmrep.json", "/sitemap.xml"]:
                url = venue["origin"] + path
                if path == "/sitemap.xml" and venue["termsVerdict"] == "no_index":
                    profile[path] = {"skipped": "terms exclude this source; no discovery crawl"}
                    continue
                if not rules.can_fetch(url, UA):
                    profile[path] = {"skipped": "robots disallow"}
                    continue
                record, body = probe.request(url, max_bytes=2_000_000)
                if path.endswith(".json"):
                    try:
                        value = json.loads(body) if record["status"] == 200 else None
                    except ValueError:
                        value = None
                    profile[path] = {"request": record, "json": value, "valid_json": value is not None}
                else:
                    profile[path] = {"request": record, "summary": sitemap_summary(record, body)}
        output["profiles"].append(profile)
        save("venues", output)


if __name__ == "__main__":
    run()
