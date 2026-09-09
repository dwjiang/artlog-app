import email.utils
import logging
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Self
from urllib import robotparser
from urllib.parse import urlsplit, urlunsplit

import httpx

log = logging.getLogger(__name__)

TRANSIENT_STATUSES = frozenset({429, 500, 502, 503, 504})


class RobotsDisallowed(Exception):
    pass


@dataclass
class CachedBody:
    etag: str | None
    last_modified: str | None
    content: bytes
    headers: dict[str, str]


@dataclass
class RobotsEntry:
    fetched_at: float
    parser: robotparser.RobotFileParser
    crawl_delay: float | None


def parse_retry_after(value: str | None, now_wall: float) -> float | None:
    if value is None:
        return None
    value = value.strip()
    if value.isdigit():
        return float(value)
    try:
        parsed = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    return max(0.0, parsed.timestamp() - now_wall)


class PoliteClient:
    """httpx client with a per-host request budget, `Retry-After` handling, ETag /
    Last-Modified conditional GETs and a daily-refreshed robots.txt cache."""

    def __init__(
        self,
        *,
        user_agent: str,
        per_host_rps: float = 1.0,
        timeout: float = 30.0,
        max_retries: int = 3,
        max_retry_after: float = 120.0,
        robots: bool = True,
        robots_ttl: float = 24 * 60 * 60,
        transport: httpx.BaseTransport | None = None,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ):
        if per_host_rps <= 0:
            raise ValueError("per_host_rps must be positive")
        self.user_agent = user_agent
        self.interval = 1.0 / per_host_rps
        self.max_retries = max_retries
        self.max_retry_after = max_retry_after
        self.robots_enabled = robots
        self.robots_ttl = robots_ttl
        self._clock = clock
        self._sleep = sleep
        self._http = httpx.Client(
            headers={"User-Agent": user_agent},
            timeout=timeout,
            follow_redirects=True,
            transport=transport,
        )
        self._next_slot: dict[str, float] = {}
        self._robots: dict[str, RobotsEntry] = {}
        self._cache: dict[str, CachedBody] = {}

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def get(self, url: str, *, headers: Mapping[str, str] | None = None) -> httpx.Response:
        host = urlsplit(url).netloc
        if self.robots_enabled and not self.allowed(url):
            raise RobotsDisallowed(url)
        request_headers = dict(headers or {})
        cached = self._cache.get(url)
        if cached is not None:
            if cached.etag:
                request_headers["If-None-Match"] = cached.etag
            if cached.last_modified:
                request_headers["If-Modified-Since"] = cached.last_modified

        response: httpx.Response | None = None
        for attempt in range(self.max_retries + 1):
            self._wait_for_slot(host)
            response = self._http.get(url, headers=request_headers)
            if response.status_code not in TRANSIENT_STATUSES:
                break
            delay = parse_retry_after(response.headers.get("Retry-After"), time.time())
            if delay is None:
                delay = min(self.max_retry_after, 2.0**attempt)
            if attempt == self.max_retries:
                break
            log.warning("%s %s; waiting %.1fs", response.status_code, url, delay)
            self._sleep(min(delay, self.max_retry_after))
        assert response is not None

        if response.status_code == 304 and cached is not None:
            replay = httpx.Response(
                200, content=cached.content, headers=cached.headers, request=response.request
            )
            replay.extensions["from_cache"] = True
            return replay
        if response.status_code == 200:
            etag = response.headers.get("ETag")
            last_modified = response.headers.get("Last-Modified")
            if etag or last_modified:
                self._cache[url] = CachedBody(
                    etag, last_modified, response.content, dict(response.headers)
                )
        return response

    def allowed(self, url: str) -> bool:
        parts = urlsplit(url)
        entry = self._robots.get(parts.netloc)
        if entry is None or self._clock() - entry.fetched_at > self.robots_ttl:
            entry = self._fetch_robots(parts.scheme, parts.netloc)
            self._robots[parts.netloc] = entry
        return entry.parser.can_fetch(self.user_agent, url)

    def _fetch_robots(self, scheme: str, host: str) -> RobotsEntry:
        parser = robotparser.RobotFileParser()
        robots_url = urlunsplit((scheme, host, "/robots.txt", "", ""))
        self._wait_for_slot(host)
        try:
            response = self._http.get(robots_url)
        except httpx.HTTPError as error:
            log.warning("robots.txt unreachable for %s (%s); disallowing", host, error)
            parser.disallow_all = True
            return RobotsEntry(self._clock(), parser, None)
        status = response.status_code
        body = response.text
        if status in (404, 410):
            parser.allow_all = True
        elif status == 200 and "<html" not in body[:512].lower():
            parser.parse(body.splitlines())
        else:
            # 5xx (RFC 9309 §2.3.1.4), access blocks and HTML stand-ins all mean "do not crawl".
            log.warning("robots.txt for %s returned %s; disallowing", host, status)
            parser.disallow_all = True
        delay = parser.crawl_delay(self.user_agent) if status == 200 else None
        return RobotsEntry(self._clock(), parser, float(delay) if delay else None)

    def _wait_for_slot(self, host: str) -> None:
        now = self._clock()
        wait = self._next_slot.get(host, now) - now
        if wait > 0:
            self._sleep(wait)
            now = self._clock()
        entry = self._robots.get(host)
        interval = max(self.interval, entry.crawl_delay or 0.0) if entry else self.interval
        self._next_slot[host] = now + interval
