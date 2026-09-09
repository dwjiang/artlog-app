import gzip
import time

import httpx
import pytest

from artlog_jobs.polite_http import PoliteClient, RobotsDisallowed, parse_retry_after

UA = "artlog-bot/0.1 (+https://example.org)"


class FakeClock:
    def __init__(self):
        self.now = 1000.0
        self.sleeps: list[float] = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


def client(handler, *, clock=None, **kwargs) -> PoliteClient:
    clock = clock or FakeClock()
    return PoliteClient(
        user_agent=UA,
        transport=httpx.MockTransport(handler),
        clock=clock,
        sleep=clock.sleep,
        **kwargs,
    )


def robots_then(text: str, page):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            return httpx.Response(200, text=text)
        return page(request)

    return handler


def test_spaces_requests_to_one_host_by_the_configured_rate():
    calls = []
    clock = FakeClock()
    c = client(
        robots_then("User-agent: *\nAllow: /\n", lambda r: calls.append(r) or httpx.Response(200)),
        clock=clock,
        per_host_rps=2.0,
    )
    for path in ("/a", "/b", "/c"):
        c.get(f"https://museum.example{path}")
    # robots.txt plus three pages, each 0.5 s apart on the same host
    assert len(calls) == 3
    assert clock.sleeps == pytest.approx([0.5, 0.5, 0.5])


def test_other_hosts_are_not_delayed():
    clock = FakeClock()
    c = client(robots_then("User-agent: *\nAllow: /\n", lambda r: httpx.Response(200)), clock=clock)
    c.get("https://a.example/x")
    c.get("https://b.example/x")
    assert clock.sleeps == pytest.approx([1.0, 1.0])


def test_real_time_spacing_with_a_short_period():
    c = PoliteClient(
        user_agent=UA,
        per_host_rps=20.0,
        robots=False,
        transport=httpx.MockTransport(lambda r: httpx.Response(200)),
    )
    started = time.monotonic()
    for _ in range(3):
        c.get("https://museum.example/page")
    assert time.monotonic() - started >= 0.1


def test_robots_disallow_is_honoured_and_crawl_delay_widens_the_interval():
    clock = FakeClock()
    c = client(
        robots_then(
            "User-agent: artlog-bot\nDisallow: /private/\nCrawl-delay: 5\n",
            lambda r: httpx.Response(200),
        ),
        clock=clock,
    )
    with pytest.raises(RobotsDisallowed):
        c.get("https://museum.example/private/x")
    c.get("https://museum.example/public")
    c.get("https://museum.example/public2")
    assert clock.sleeps[-1] == pytest.approx(5.0)


def test_robots_server_error_disallows_everything_until_refetched():
    status = {"code": 503}
    clock = FakeClock()
    c = client(
        lambda r: httpx.Response(status["code"], text="User-agent: *\nAllow: /\n"),
        clock=clock,
        robots_ttl=60,
    )
    with pytest.raises(RobotsDisallowed):
        c.get("https://museum.example/x")
    status["code"] = 200
    with pytest.raises(RobotsDisallowed):
        c.get("https://museum.example/x")
    clock.now += 61
    assert c.get("https://museum.example/x").status_code == 200


def test_missing_robots_allows_and_html_or_forbidden_robots_disallow():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path != "/robots.txt":
            return httpx.Response(200)
        return {
            "missing.example": httpx.Response(404),
            "html.example": httpx.Response(200, text="<!DOCTYPE html><html>challenge</html>"),
            "blocked.example": httpx.Response(403, text="User-agent: *\nAllow: /\n"),
        }[request.url.host]

    c = client(handler)
    assert c.get("https://missing.example/x").status_code == 200
    with pytest.raises(RobotsDisallowed):
        c.get("https://html.example/x")
    with pytest.raises(RobotsDisallowed):
        c.get("https://blocked.example/x")


def test_retry_after_is_waited_out_then_the_request_is_retried():
    attempts = []

    def page(request: httpx.Request) -> httpx.Response:
        attempts.append(request)
        if len(attempts) == 1:
            return httpx.Response(429, headers={"Retry-After": "7"})
        return httpx.Response(200, text="ok")

    clock = FakeClock()
    c = client(robots_then("User-agent: *\nAllow: /\n", page), clock=clock)
    response = c.get("https://museum.example/x")
    assert response.text == "ok" and len(attempts) == 2
    assert 7.0 in clock.sleeps


def test_gives_up_after_max_retries_and_returns_the_last_response():
    c = client(lambda r: httpx.Response(503), robots=False, max_retries=2)
    assert c.get("https://museum.example/x").status_code == 503


def test_conditional_get_replays_the_cached_body_on_304():
    seen_headers = []

    def page(request: httpx.Request) -> httpx.Response:
        seen_headers.append(dict(request.headers))
        if request.headers.get("If-None-Match") == '"v1"':
            return httpx.Response(304)
        return httpx.Response(
            200,
            content=b"body-v1",
            headers={"ETag": '"v1"', "Last-Modified": "Mon, 01 Jan 2024 00:00:00 GMT"},
        )

    c = client(page, robots=False)
    first = c.get("https://museum.example/x")
    second = c.get("https://museum.example/x")
    assert first.content == b"body-v1" and not first.extensions.get("from_cache")
    assert second.status_code == 200 and second.content == b"body-v1"
    assert second.extensions["from_cache"] is True
    assert seen_headers[1]["if-none-match"] == '"v1"'
    assert seen_headers[1]["if-modified-since"] == "Mon, 01 Jan 2024 00:00:00 GMT"


@pytest.mark.parametrize(
    "changed_header,value", [("Accept-Language", "fr"), ("Accept", "text/plain")]
)
def test_vary_only_revalidates_a_matching_representation(changed_header, value):
    seen = []
    modified = "Mon, 01 Jan 2024 00:00:00 GMT"

    def page(request):
        seen.append(request)
        headers = {"Vary": "aCcEpT-LaNgUaGe, Accept", "Last-Modified": modified}
        if request.headers.get("If-Modified-Since") == modified:
            return httpx.Response(304, headers=headers)
        body = f"{request.headers['Accept-Language']}:{request.headers['Accept']}"
        return httpx.Response(200, text=body, headers=headers)

    original = {"Accept-Language": "en", "Accept": "text/html"}
    changed = {**original, changed_header: value}
    with client(page, robots=False) as c:
        first = c.get("https://museum.example/painting", headers=original)
        repeated = c.get("https://museum.example/painting", headers=original)
        variant = c.get("https://museum.example/painting", headers=changed)
        repeated_variant = c.get("https://museum.example/painting", headers=changed)

    assert first.text == repeated.text == "en:text/html"
    assert repeated.extensions["from_cache"] is True
    assert variant.text == f"{changed['Accept-Language']}:{changed['Accept']}"
    assert repeated_variant.text == variant.text
    assert repeated_variant.extensions["from_cache"] is True
    assert "If-Modified-Since" not in seen[2].headers


def test_vary_distinguishes_an_absent_request_header_from_an_empty_one():
    def page(request):
        headers = {"Vary": "Accept-Language", "ETag": '"v1"'}
        if "If-None-Match" in request.headers:
            return httpx.Response(304, headers=headers)
        body = "present" if "Accept-Language" in request.headers else "absent"
        return httpx.Response(200, text=body, headers=headers)

    with client(page, robots=False) as c:
        assert c.get("https://museum.example/painting").text == "absent"
        assert (
            c.get("https://museum.example/painting", headers={"Accept-Language": ""}).text
            == "present"
        )


@pytest.mark.parametrize("vary", ["*", "Accept-Language, *"])
def test_vary_star_responses_are_never_reused(vary):
    seen = []

    def page(request):
        seen.append(request)
        return httpx.Response(200, text="painting", headers={"Vary": vary, "ETag": '"v1"'})

    with client(page, robots=False) as c:
        for _ in range(2):
            assert c.get("https://museum.example/painting").text == "painting"
    assert all("If-None-Match" not in request.headers for request in seen)


@pytest.mark.parametrize("vary", ["Accept-Language", "*"])
def test_vary_from_a_304_controls_subsequent_cache_reuse(vary):
    seen = []

    def page(request):
        seen.append(request)
        if len(seen) == 1:
            return httpx.Response(200, text="painting", headers={"ETag": '"v1"'})
        if "If-None-Match" in request.headers:
            return httpx.Response(304, headers={"Vary": vary, "ETag": '"v1"'})
        return httpx.Response(200, text="fresh painting")

    with client(page, robots=False) as c:
        c.get("https://museum.example/painting", headers={"Accept-Language": "en"})
        replay = c.get("https://museum.example/painting", headers={"Accept-Language": "en"})
        next_language = "fr" if vary == "Accept-Language" else "en"
        fresh = c.get("https://museum.example/painting", headers={"Accept-Language": next_language})

    assert replay.text == "painting" and replay.extensions["from_cache"] is True
    assert replay.headers["Vary"] == vary
    assert fresh.text == "fresh painting"
    assert "If-None-Match" not in seen[2].headers


def test_user_agent_is_sent():
    seen = []
    c = client(lambda r: seen.append(r.headers["User-Agent"]) or httpx.Response(200), robots=False)
    c.get("https://museum.example/x")
    assert seen == [UA]


def test_parse_retry_after_accepts_seconds_and_http_dates():
    assert parse_retry_after("12", 0.0) == 12.0
    assert parse_retry_after(None, 0.0) is None
    assert parse_retry_after("Thu, 01 Jan 1970 00:00:30 GMT", 10.0) == pytest.approx(20.0)
    assert parse_retry_after("garbage", 0.0) is None


def test_compressed_cached_content_is_replayed_without_decoding_it_again():
    body = b"painting metadata" * 20

    def page(request):
        if request.headers.get("If-None-Match") == '"v1"':
            return httpx.Response(304)
        return httpx.Response(
            200,
            content=gzip.compress(body),
            headers={"Content-Encoding": "gzip", "ETag": '"v1"'},
        )

    with client(page, robots=False) as c:
        assert c.get("https://museum.example/x").content == body
        cached = c.get("https://museum.example/x")
    assert cached.content == body
    assert cached.extensions["from_cache"] is True
    assert "Content-Encoding" not in cached.headers
    assert int(cached.headers["Content-Length"]) == len(body)


@pytest.mark.parametrize("target", ["/private/x", "https://other.example/private/x"])
def test_redirects_cannot_fetch_a_disallowed_destination(target):
    visited = []

    def handler(request):
        visited.append(str(request.url))
        if request.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nDisallow: /private/\n")
        if request.url.path == "/public":
            return httpx.Response(302, headers={"Location": target})
        return httpx.Response(200)

    with client(handler) as c, pytest.raises(RobotsDisallowed):
        c.get("https://museum.example/public")
    assert not any("/private/" in url for url in visited)
    if target.startswith("https:"):
        assert "https://other.example/robots.txt" in visited


@pytest.mark.parametrize("initial_scheme,target_scheme", [("http", "https"), ("https", "http")])
def test_redirects_check_the_destination_scheme_robots(initial_scheme, target_scheme):
    visited = []
    target = f"{target_scheme}://museum.example/private/x"

    def handler(request):
        visited.append(str(request.url))
        if request.url.path == "/robots.txt":
            if request.url.scheme == initial_scheme:
                return httpx.Response(404)
            return httpx.Response(200, text="User-agent: *\nDisallow: /private/\n")
        if request.url.path == "/public":
            return httpx.Response(302, headers={"Location": target})
        return httpx.Response(200)

    with client(handler) as c, pytest.raises(RobotsDisallowed):
        c.get(f"{initial_scheme}://museum.example/public")
    assert f"{target_scheme}://museum.example/robots.txt" in visited
    assert target not in visited


def test_each_scheme_keeps_its_crawl_delay_after_both_policies_are_cached():
    clock = FakeClock()
    visited = []

    def handler(request):
        visited.append((str(request.url), clock()))
        delay = 5 if request.url.scheme == "http" else 10
        return httpx.Response(200, text=f"User-agent: *\nCrawl-delay: {delay}\n")

    with client(handler, clock=clock) as c:
        for scheme in ("http", "https", "http", "http", "https", "https"):
            c.get(f"{scheme}://museum.example/page")
    pages = [(url, at) for url, at in visited if url.endswith("/page")]
    assert pages == [
        ("http://museum.example/page", 1005.0),
        ("https://museum.example/page", 1020.0),
        ("http://museum.example/page", 1030.0),
        ("http://museum.example/page", 1035.0),
        ("https://museum.example/page", 1040.0),
        ("https://museum.example/page", 1050.0),
    ]


def test_redirect_hops_are_spaced_and_keep_response_history():
    clock = FakeClock()
    visited = []

    def handler(request):
        visited.append((request.url.path, clock()))
        if request.url.path == "/start":
            return httpx.Response(302, headers={"Location": "/painting"})
        return httpx.Response(200)

    with client(handler, clock=clock, robots=False) as c:
        response = c.get("https://museum.example/start")
    assert visited == [("/start", 1000.0), ("/painting", 1001.0)]
    assert response.url.path == "/painting"
    assert [r.status_code for r in response.history] == [302]


def test_redirect_loops_have_a_finite_limit():
    visited = []

    def handler(request):
        visited.append(request)
        return httpx.Response(302, headers={"Location": "/loop"})

    with client(handler, robots=False) as c, pytest.raises(httpx.TooManyRedirects):
        c.get("https://museum.example/loop")
    assert len(visited) <= 21


def test_redirects_use_the_destination_cache_and_strip_cross_host_credentials():
    seen = []

    def handler(request):
        seen.append(request)
        if request.url.host == "museum.example":
            return httpx.Response(302, headers={"Location": "https://other.example/painting"})
        if request.headers.get("If-None-Match") == '"painting-v1"':
            return httpx.Response(304)
        return httpx.Response(200, content=b"painting", headers={"ETag": '"painting-v1"'})

    with client(handler, robots=False) as c:
        for _ in range(2):
            response = c.get("https://museum.example/start", headers={"Authorization": "test"})
    assert response.content == b"painting"
    assert response.extensions["from_cache"] is True
    assert "If-None-Match" not in seen[2].headers
    assert seen[3].headers["If-None-Match"] == '"painting-v1"'
    assert all("Authorization" not in r.headers for r in (seen[1], seen[3]))


def test_robots_redirects_are_rate_limited_and_the_result_applies_to_the_original_host():
    clock = FakeClock()
    visited = []

    def handler(request):
        visited.append((request.url.path, clock()))
        if request.url.path == "/robots.txt":
            return httpx.Response(302, headers={"Location": "/policy.txt"})
        return httpx.Response(200, text="User-agent: *\nDisallow: /private/\n")

    with client(handler, clock=clock) as c, pytest.raises(RobotsDisallowed):
        c.get("https://museum.example/private/x")
    assert visited == [("/robots.txt", 1000.0), ("/policy.txt", 1001.0)]


def test_cache_evicts_least_recently_used_bodies_within_the_byte_budget():
    seen = []

    def handler(request):
        seen.append(request)
        if request.headers.get("If-None-Match"):
            return httpx.Response(304)
        return httpx.Response(200, content=b"1234", headers={"ETag": request.url.path})

    with client(handler, robots=False, cache_max_bytes=8) as c:
        for path in ("/a", "/b", "/a", "/c", "/a", "/b"):
            c.get(f"https://museum.example{path}")
    assert "If-None-Match" in seen[2].headers
    assert "If-None-Match" in seen[4].headers
    assert "If-None-Match" not in seen[5].headers


@pytest.mark.parametrize("budget", [0, 3])
def test_disabled_cache_and_oversized_bodies_do_not_send_conditional_headers(budget):
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, content=b"1234", headers={"ETag": '"v1"'})

    with client(handler, robots=False, cache_max_bytes=budget) as c:
        for _ in range(2):
            c.get("https://museum.example/image.jpg")
    assert "If-None-Match" not in seen[1].headers


def test_empty_response_bodies_cannot_grow_the_cache_indefinitely():
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, content=b"", headers={"ETag": '"empty"'})

    with client(handler, robots=False) as c:
        for i in range(200):
            c.get(f"https://museum.example/{i}")
        c.get("https://museum.example/0")
    assert "If-None-Match" not in seen[-1].headers


def test_replacing_a_cached_body_updates_the_budget_and_removes_stale_validators():
    seen = []
    replies = iter(
        [
            httpx.Response(200, content=b"1234", headers={"ETag": '"v1"'}),
            httpx.Response(200, content=b"5678", headers={"ETag": '"v2"'}),
            httpx.Response(200, content=b"abcd", headers={"ETag": '"b"'}),
            httpx.Response(200, content=b"uncached"),
            httpx.Response(200, content=b"uncached"),
        ]
    )

    def handler(request):
        seen.append(request)
        return next(replies)

    with client(handler, robots=False, cache_max_bytes=8) as c:
        for path in ("/a", "/a", "/b", "/a", "/a"):
            c.get(f"https://museum.example{path}")
    assert seen[3].headers["If-None-Match"] == '"v2"'
    assert "If-None-Match" not in seen[4].headers


@pytest.mark.parametrize("max_retries", [0, 3])
def test_long_retry_after_defers_the_host_without_blocking_other_hosts(max_retries):
    from artlog_jobs.polite_http import RetryLater

    clock = FakeClock()
    seen = []

    def handler(request):
        seen.append((request.url.host, clock()))
        if len(seen) == 1:
            return httpx.Response(429, headers={"Retry-After": "3600"})
        return httpx.Response(200)

    with client(handler, clock=clock, robots=False, max_retries=max_retries) as c:
        with pytest.raises(RetryLater) as raised:
            c.get("https://museum.example/a")
        assert raised.value.retry_after == 3600
        assert clock.sleeps == []
        with pytest.raises(RetryLater):
            c.get("https://museum.example/b")
        assert c.get("https://other.example/x").status_code == 200
        clock.now += 3600
        assert c.get("https://museum.example/b").status_code == 200
    assert seen == [
        ("museum.example", 1000.0),
        ("other.example", 1000.0),
        ("museum.example", 4600.0),
    ]


def test_retry_after_on_the_last_attempt_still_delays_the_next_request():
    clock = FakeClock()
    seen = []

    def handler(request):
        seen.append(clock())
        if len(seen) == 1:
            return httpx.Response(503, headers={"Retry-After": "7"})
        return httpx.Response(200)

    with client(handler, clock=clock, robots=False, max_retries=0) as c:
        assert c.get("https://museum.example/a").status_code == 503
        assert c.get("https://museum.example/b").status_code == 200
    assert seen == [1000.0, 1007.0]


def test_new_and_refreshed_crawl_delay_applies_to_the_first_page():
    clock = FakeClock()
    seen = []
    delay = 30

    def handler(request):
        seen.append((request.url.path, clock()))
        return httpx.Response(200, text=f"User-agent: *\nCrawl-delay: {delay}\n")

    with client(handler, clock=clock, robots_ttl=60) as c:
        c.get("https://museum.example/a")
        clock.now += 61
        delay = 45
        c.get("https://museum.example/b")
    assert seen == [
        ("/robots.txt", 1000.0),
        ("/a", 1030.0),
        ("/robots.txt", 1091.0),
        ("/b", 1136.0),
    ]
