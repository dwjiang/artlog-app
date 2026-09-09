import importlib.util
import json
import sys
from pathlib import Path

import httpx
import pytest

import probe as probe_module
from probe import Probe
from robots import robots_policy


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


venues = load("venues-probe")
met = load("met-counts")
replacement = load("replacement-probe")
aic = load("aic-counts")


@pytest.fixture
def mock_runner(monkeypatch, tmp_path):
    monkeypatch.setattr(probe_module, "ROOT", tmp_path)
    monkeypatch.setattr(probe_module.time, "sleep", lambda _: None)
    clients = []

    def configure(module, handler):
        probe = Probe(interval=0)
        probe.client.close()
        probe.client = httpx.Client(transport=httpx.MockTransport(handler))
        clients.append(probe.client)
        monkeypatch.setattr(module, "Probe", lambda **kwargs: probe)

    yield configure
    for client in clients:
        client.close()


class InterruptedBody(httpx.SyncByteStream):
    def __iter__(self):
        yield b'{"count": 1}'
        raise httpx.ReadTimeout("body read timeout")


@pytest.mark.parametrize("status,verdict", [(503, "disallow"), (None, "disallow"), (403, "hold"), (429, "hold"), (302, "hold"), (404, "not_present")])
def test_robots_failures_do_not_become_permission(status, verdict):
    assert robots_policy({"status": status}, "", "https://museum.test/objects/1")["verdict"] == verdict


def test_robots_honors_specific_bot_group_wildcards_and_delay():
    body = "User-agent: *\nAllow: /\n\nUser-agent: artlog-bot\nDisallow: /objects/*\nAllow: /objects/public/\nCrawl-delay: 30\n"
    assert robots_policy({"status": 200}, body, "https://museum.test/objects/1")["allowed"] is False
    public = robots_policy({"status": 200}, body, "https://museum.test/objects/public/1")
    assert public["allowed"] is True
    assert public["crawl_delay"] == 30


def test_soft_error_pages_are_neither_robots_permission_nor_sitemaps():
    assert robots_policy({"status": 200}, "<!DOCTYPE html><html>Challenge</html>", "https://museum.test/")["verdict"] == "hold"
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
    assert robots_policy({"status": 200}, body, "https://www.famsf.org/art/example")["allowed"] is False


@pytest.mark.parametrize("host", ["www.clevelandart.org", "openaccess-api.clevelandart.org"])
@pytest.mark.parametrize("failure", ["html", "truncated", "interrupted"])
def test_replacement_does_not_fetch_content_after_unusable_robots(host, failure, mock_runner, tmp_path):
    calls = []

    def handle(request):
        calls.append(request)
        if request.url.path == "/robots.txt":
            if request.url.host != host:
                return httpx.Response(200, text="User-agent: *\nAllow: /\n")
            if failure == "html":
                return httpx.Response(200, text="<!DOCTYPE html><html>Challenge</html>")
            if failure == "truncated":
                return httpx.Response(200, content=b"#" + b"x" * 8_000_001)
            return httpx.Response(200, stream=InterruptedBody())
        return httpx.Response(200, text="<urlset/>")

    mock_runner(replacement, handle)
    replacement.run()

    assert [request.url.path for request in calls if request.url.host == host] == ["/robots.txt"]
    output = json.loads((tmp_path / "results/replacement.json").read_text())
    assert "on_view_api" not in output
    if host == "www.clevelandart.org":
        assert output["object_pages_fetched"] == 0


@pytest.mark.parametrize("api_policy", ["allowed", "absent", "disallowed"])
def test_replacement_applies_each_origins_path_permissions(api_policy, mock_runner, tmp_path):
    calls = []

    def handle(request):
        calls.append(request)
        if request.url.path == "/robots.txt":
            if request.url.host == "www.clevelandart.org":
                return httpx.Response(200, text="User-agent: *\nDisallow: /art/\n")
            if api_policy == "absent":
                return httpx.Response(404, text="<html>Not found</html>")
            return httpx.Response(200, text="User-agent: *\n" + ("Disallow: /api/\n" if api_policy == "disallowed" else "Allow: /\n"))
        if request.url.path == "/api/artworks/":
            return httpx.Response(200, json={"info": {"total": 1}, "data": [{"id": 1}]})
        return httpx.Response(200, text="<urlset/>")

    mock_runner(replacement, handle)
    replacement.run()

    assert not any(request.url.path.startswith("/art/") for request in calls)
    assert sum(request.url.path == "/sitemap.xml" for request in calls) == 2
    output = json.loads((tmp_path / "results/replacement.json").read_text())
    assert output["object_pages_fetched"] == 0
    assert ("on_view_api" in output) == (api_policy != "disallowed")


@pytest.mark.parametrize("status", [200, 429])
def test_interrupted_responses_keep_headers_and_never_return_partial_json(status):
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(status, headers={"Retry-After": "120"}, stream=InterruptedBody())

    probe = Probe(interval=0)
    probe.client.close()
    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        probe.client = client
        record, data = probe.json("https://museum.test/api")
        assert data is None
        assert record["status"] == status
        assert record["headers"]["retry-after"] == "120"
        assert "ReadTimeout" in record["error"]
        if status == 429:
            skipped, _ = probe.json("https://museum.test/another-path")
            assert "Skipped" in skipped["error"]
            assert len(calls) == 1


@pytest.mark.parametrize("has_source", [False, True])
def test_met_cached_csv_needs_no_github_lookup(has_source, mock_runner, monkeypatch, tmp_path):
    csv_path = tmp_path / "MetObjects.csv"
    csv_path.write_text("Object ID,Classification,Is Public Domain\n1,Paintings,True\n")
    source = "https://media.githubusercontent.com/media/metmuseum/openaccess/pinned-revision/MetObjects.csv"
    if has_source:
        csv_path.with_suffix(".source").write_text(source)
    monkeypatch.setattr(sys, "argv", ["met-counts.py", "--csv", str(csv_path)])
    calls = []

    def handle(request):
        calls.append(request)
        if request.url.host == "api.github.com":
            return httpx.Response(403)
        return httpx.Response(200, json={"objectID": 1, "isPublicDomain": True})

    mock_runner(met, handle)
    met.run()

    assert [str(request.url) for request in calls] == [met.BASE + "/objects/1"]
    output = json.loads((tmp_path / "results/met.json").read_text())
    assert output["counts"]["public_domain_paintings"] == 1
    assert output["sample"]["objects"][0]["data"]["objectID"] == 1
    assert output["csv_url"] == (source if has_source else "unknown: caller-supplied local CSV")
    assert output["revision"] == ("pinned-revision" if has_source else None)


def test_met_failed_revision_discovery_records_why_no_csv_was_downloaded(mock_runner, monkeypatch, tmp_path):
    csv_path = tmp_path / "missing.csv"
    monkeypatch.setattr(sys, "argv", ["met-counts.py", "--csv", str(csv_path)])
    mock_runner(met, lambda request: httpx.Response(403))

    met.run()

    assert not csv_path.exists()
    output = json.loads((tmp_path / "results/met.json").read_text())
    assert output["counts"] is None
    assert output["reason"]
    assert len(output["requests"]) == 1
    assert output["requests"][0]["status"] == 403


@pytest.mark.parametrize("failure", ["503", "429", "timeout", "invalid_json", "missing_painting"])
def test_aic_failed_type_discovery_saves_unknown_counts(failure, mock_runner, tmp_path):
    calls = []

    def handle(request):
        calls.append(request)
        if failure == "timeout":
            raise httpx.ReadTimeout("type discovery timeout")
        if failure == "invalid_json":
            return httpx.Response(200, text="not JSON")
        if failure == "missing_painting":
            return httpx.Response(200, json={"data": []})
        return httpx.Response(int(failure))

    mock_runner(aic, handle)
    aic.run()

    assert [str(request.url) for request in calls] == [aic.BASE + "/artwork-types?limit=100"]
    output = json.loads((tmp_path / "results/aic.json").read_text())
    assert set(output["counts"]) == {
        "paintings", "paintings_with_image", "paintings_with_image_public_domain",
        "paintings_with_image_on_view", "paintings_with_image_public_domain_on_view",
    }
    assert all(value["count"] is None and value["reason"] for value in output["counts"].values())
    assert len(output["requests"]) == 1
    assert output["requests"][0]["status"] == (None if failure == "timeout" else int(failure) if failure.isdigit() else 200)
