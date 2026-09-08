from html.parser import HTMLParser
import re
from urllib.parse import urlsplit

from protego import Protego

from probe import Probe, UA, now, save


def object_urls(locations):
    return [url for url in locations if re.fullmatch(r"/art/\d[^/]*", urlsplit(url).path)]


class Metadata(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tdm = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "meta" and attrs.get("name", "").lower() in ("tdm-reservation", "tdm-policy"):
            self.tdm.append(attrs)


def run():
    probe = Probe(interval=10)
    output = {"started_at": now(), "object_pages_fetched": 0}
    origin = "https://www.clevelandart.org"
    record, robots = probe.request(origin + "/robots.txt")
    output["robots"] = record
    if record["status"] != 200:
        save("replacement", output)
        return
    rules = Protego.parse(robots)
    probe.interval = max(10, rules.crawl_delay(UA) or 0)
    for path in ["/sitemap.xml?page=1", "/sitemap.xml?page=2", "/art/1927.393"]:
        url = origin + path
        if not rules.can_fetch(url, UA):
            output[path] = {"skipped": "robots disallow"}
            continue
        record, body = probe.request(url)
        parser = Metadata()
        parser.feed(body)
        evidence = {"request": record, "tdm_meta": parser.tdm}
        if path.startswith("/sitemap"):
            import xml.etree.ElementTree as ET
            try:
                locations = [node.text for node in ET.fromstring(body).iter() if node.tag.split("}")[-1] == "loc"]
                objects = object_urls(locations)
                evidence.update(locations_count=len(locations), object_urls_count=len(objects), object_url_examples=objects[:3])
            except ET.ParseError:
                evidence["error"] = "not XML"
        else:
            output["object_pages_fetched"] += 1
        output[path] = evidence
    # Separate, documented public API origin; never use the disallowed website /api path.
    api = "https://openaccess-api.clevelandart.org"
    record, body = probe.request(api + "/robots.txt")
    output["api_robots"] = {"request": record, "body": body if record["status"] == 200 else None}
    allowed = record["status"] in (404, 410) or (record["status"] == 200 and "<html" not in body.lower() and Protego.parse(body).can_fetch(api + "/api/artworks/", UA))
    if allowed:
        record, data = probe.json(api + "/api/artworks/?type=Painting&cc0&currently_on_view&limit=1&fields=id,accession_number,title,url,share_license_status,current_location")
        output["on_view_api"] = {"request": record, "response": data}
    save("replacement", output)


if __name__ == "__main__":
    run()
