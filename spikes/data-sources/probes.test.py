import importlib.util
from pathlib import Path

import httpx
import pytest

from probe import Probe


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


venues = load("venues-probe")
met = load("met-counts")
replacement = load("replacement-probe")


@pytest.mark.parametrize("status,verdict", [(503, "disallow"), (None, "disallow"), (403, "hold"), (429, "hold"), (302, "hold"), (404, "not_present")])
def test_robots_failures_do_not_become_permission(status, verdict):
    assert venues.robots_policy({"status": status}, "", "https://museum.test/objects/1")["verdict"] == verdict


def test_robots_honors_specific_bot_group_wildcards_and_delay():
    body = "User-agent: *\nAllow: /\n\nUser-agent: artlog-bot\nDisallow: /objects/*\nAllow: /objects/public/\nCrawl-delay: 30\n"
    assert venues.robots_policy({"status": 200}, body, "https://museum.test/objects/1")["allowed"] is False
    public = venues.robots_policy({"status": 200}, body, "https://museum.test/objects/public/1")
    assert public["allowed"] is True
    assert public["crawl_delay"] == 30


def test_soft_error_pages_are_neither_robots_permission_nor_sitemaps():
    assert venues.robots_policy({"status": 200}, "<!DOCTYPE html><html>Challenge</html>", "https://museum.test/")["verdict"] == "hold"
    assert venues.sitemap_summary({"status": 200}, "<html>Not found</html>")["kind"] == "unknown"


def test_sitemap_index_does_not_claim_to_enumerate_objects():
    result = venues.sitemap_summary({"status": 200}, '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://museum.test/objects.xml</loc></sitemap></sitemapindex>')
    assert result == {"kind": "sitemapindex", "locations_count": 1, "sample_locations": ["https://museum.test/objects.xml"]}


def test_met_counts_exact_classification_without_inventing_image_availability():
    def row(object_id, classification="Paintings", public="True", gallery="", wikidata=""):
        return {"Object ID": str(object_id), "Classification": classification, "Is Public Domain": public, "Gallery Number": gallery, "Object Wikidata URL": wikidata}
    counts, ids = met.count_rows([row(1, gallery="240", wikidata="https://www.wikidata.org/wiki/Q1"), row(2, public="False"), row(3, classification="Paintings-Scrolls"), row(4, gallery="  ")])
    assert counts == {"rows": 4, "paintings": 3, "public_domain_paintings": 2, "public_domain_paintings_on_view": 1, "public_domain_paintings_wikidata": 1}
    assert ids == [1, 4]


def test_http_failure_is_recorded_without_retry_or_redirect():
    probe = Probe(interval=0)
    calls = []
    def handle(request):
        calls.append(request)
        return httpx.Response(429, headers={"Retry-After": "120"}, text="slow down")
    probe.client = httpx.Client(transport=httpx.MockTransport(handle))
    record, data = probe.json("https://museum.test/api")
    assert data is None
    assert record["headers"]["retry-after"] == "120"
    skipped, _ = probe.json("https://museum.test/another-path")
    assert "Skipped" in skipped["error"]
    assert len(calls) == 1


def test_cleveland_collection_navigation_is_not_an_object_page():
    assert replacement.object_urls([
        "https://www.clevelandart.org/art/collection/search",
        "https://www.clevelandart.org/art/collection/request-image",
        "https://www.clevelandart.org/art/1927.393",
    ]) == ["https://www.clevelandart.org/art/1927.393"]


def test_famsf_object_disallow_survives_managed_allow_group():
    body = "User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow: /art/*\nDisallow: *?*=*\n"
    assert venues.robots_policy({"status": 200}, body, "https://www.famsf.org/art/example")["allowed"] is False
