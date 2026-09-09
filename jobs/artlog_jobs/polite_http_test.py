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
