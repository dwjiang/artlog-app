import email.utils
import logging
import threading
import time
from collections import OrderedDict, deque
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass
from typing import Self
from urllib import robotparser
from urllib.parse import urlsplit, urlunsplit

import httpx

log = logging.getLogger(__name__)

TRANSIENT_STATUSES = frozenset({429, 500, 502, 503, 504})
MAX_CACHE_ENTRIES = 128
# HTTPX's default HTTP/1.1 transport reads at most 64 KiB from the socket at a time.
READ_CHUNK_BYTES = 64 * 1024


class RobotsDisallowed(Exception):
    pass


class RetryLater(Exception):
    def __init__(self, host: str, retry_after: float, status_code: int):
        self.host = host
        self.retry_after = retry_after
        self.status_code = status_code
        super().__init__(f"{host} is cooling down; retry in {retry_after:.1f}s")


@dataclass
class CachedBody:
    etag: str | None
    last_modified: str | None
    content: bytes
    headers: dict[str, str]
    vary_headers: dict[str, str | None]


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


class BandwidthLimiter:
    """Shared budget for completed and in-flight response chunks in a trailing window."""

    def __init__(
        self,
        mbps: float,
        *,
        window: float = 10.0,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ):
        if mbps <= 0 or window <= 0:
            raise ValueError("bandwidth cap and window must be positive")
        self.budget_bytes = int(mbps * 1e6 / 8 * window)
        if self.budget_bytes < READ_CHUNK_BYTES:
            raise ValueError("bandwidth budget must allow at least 64 KiB per window")
        self.window = window
        self._clock = clock
        self._sleep = sleep
        self._events: deque[tuple[float, int]] = deque()
        self._in_flight = 0
        self._condition = threading.Condition()

    def _read_chunk(self, chunks: Iterator[bytes]) -> bytes:
        while True:
            with self._condition:
                now = self._clock()
                while self._events and self._events[0][0] <= now - self.window:
                    self._events.popleft()
                used = sum(size for _, size in self._events)
                if used + self._in_flight + READ_CHUNK_BYTES <= self.budget_bytes:
                    self._in_flight += READ_CHUNK_BYTES
                    break
                if not self._events:
                    self._condition.wait()
                    continue
                delay = self._events[0][0] + self.window - now
            self._sleep(delay)
        # Failed reads may have received partial bytes; retain their entire reservation.
        received = READ_CHUNK_BYTES
        try:
            chunk = next(chunks)
            received = len(chunk)
            if received > READ_CHUNK_BYTES:
                raise ValueError("HTTP transport exceeded the reserved 64 KiB read size")
            return chunk
        except StopIteration:
            received = 0
            raise
        finally:
            with self._condition:
                self._in_flight -= READ_CHUNK_BYTES
                if received:
                    self._events.append((self._clock(), received))
                self._condition.notify_all()

    def read_response(self, response: httpx.Response) -> httpx.Response:
        headers = dict(response.headers)
        # In-memory transports can return buffered, already decoded responses.
        if response.is_stream_consumed:
            chunks = response.iter_bytes(chunk_size=READ_CHUNK_BYTES)
            headers.pop("content-encoding", None)
            headers.pop("content-length", None)
        else:
            # Rechunking can read ahead past the reservation to fill an output chunk.
            chunks = response.iter_raw()
        body = bytearray()
        try:
            while True:
                try:
                    body.extend(self._read_chunk(chunks))
                except StopIteration:
                    break
            result = httpx.Response(
                response.status_code,
                headers=headers,
                content=bytes(body),
                request=response.request,
                extensions=response.extensions,
            )
            result.next_request = response.next_request
            return result
        finally:
            response.close()


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
        cache_max_bytes: int = 16 * 1024 * 1024,
        transport: httpx.BaseTransport | None = None,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ):
        if per_host_rps <= 0:
            raise ValueError("per_host_rps must be positive")
        if max_retries < 0 or max_retry_after < 0 or cache_max_bytes < 0:
            raise ValueError("retry and cache limits must be non-negative")
        self.user_agent = user_agent
        self.interval = 1.0 / per_host_rps
        self.max_retries = max_retries
        self.max_retry_after = max_retry_after
        self.robots_enabled = robots
        self.robots_ttl = robots_ttl
        self.cache_max_bytes = cache_max_bytes
        self._clock = clock
        self._sleep = sleep
        self._http = httpx.Client(
            headers={"User-Agent": user_agent},
            timeout=timeout,
            follow_redirects=False,
            transport=transport,
        )
        self._next_slot: dict[str, float] = {}
        self._slot_lock = threading.Lock()
        self._cooldowns: dict[str, tuple[float, int]] = {}
        self._robots: dict[tuple[str, str], RobotsEntry] = {}
        self._cache: OrderedDict[str, CachedBody] = OrderedDict()
        self._cache_bytes = 0

    def close(self) -> None:
        self._http.close()
        self._cache.clear()
        self._cache_bytes = 0

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def get(
        self,
        url: str,
        *,
        headers: Mapping[str, str] | None = None,
        limiter: BandwidthLimiter | None = None,
    ) -> httpx.Response:
        return self._get(url, headers=headers, check_robots=self.robots_enabled, limiter=limiter)

    def _get(
        self,
        url: str,
        *,
        headers: Mapping[str, str] | None = None,
        check_robots: bool,
        limiter: BandwidthLimiter | None = None,
    ) -> httpx.Response:
        request = self._http.build_request("GET", url, headers=headers)
        history: list[httpx.Response] = []
        for _ in range(self._http.max_redirects + 1):
            url = str(request.url)
            if check_robots and not self.allowed(url):
                raise RobotsDisallowed(url)
            cached = self._cache.get(url)
            if cached is not None and any(
                request.headers.get(name) != value for name, value in cached.vary_headers.items()
            ):
                cached = None
            if cached is not None:
                if cached.etag:
                    request.headers["If-None-Match"] = cached.etag
                if cached.last_modified:
                    request.headers["If-Modified-Since"] = cached.last_modified

            response = self._send_with_retries(request, limiter=limiter)
            response.history = list(history)
            if response.next_request is None:
                if response.status_code == 304 and cached is not None:
                    replay_headers = {**cached.headers, **dict(response.headers)}
                    # Revalidation can update Vary, but the cached body is already decoded.
                    for name in ("content-encoding", "content-length", "transfer-encoding"):
                        replay_headers.pop(name, None)
                    replay = httpx.Response(
                        200,
                        content=cached.content,
                        headers=replay_headers,
                        request=response.request,
                        history=response.history,
                    )
                    self._remember(url, replay)
                    replay.extensions["from_cache"] = True
                    return replay
                if response.status_code == 200:
                    self._remember(url, response)
                return response

            history.append(response)
            request = response.next_request
            # Validators describe the previous URL's representation, not the redirect target.
            request.headers.pop("If-None-Match", None)
            request.headers.pop("If-Modified-Since", None)
        raise httpx.TooManyRedirects("Exceeded maximum allowed redirects", request=request)

    def _send_with_retries(
        self,
        request: httpx.Request,
        *,
        limiter: BandwidthLimiter | None,
    ) -> httpx.Response:
        url = str(request.url)
        host = urlsplit(url).netloc
        for attempt in range(self.max_retries + 1):
            self._wait_for_slot(url)
            response = self._http.send(request, stream=True)
            delay = None
            try:
                if response.status_code in TRANSIENT_STATUSES:
                    delay = parse_retry_after(response.headers.get("Retry-After"), time.time())
                    if delay is None:
                        delay = min(self.max_retry_after, 2.0**attempt)
                    with self._slot_lock:
                        until = self._clock() + delay
                        if until > self._cooldowns.get(host, (0.0, 0))[0]:
                            self._cooldowns[host] = (until, response.status_code)
                if limiter is not None:
                    response = limiter.read_response(response)
                else:
                    response.read()
            finally:
                response.close()
            if delay is None:
                return response
            remaining = max(0.0, until - self._clock())
            if remaining > self.max_retry_after:
                raise RetryLater(host, remaining, response.status_code)
            if attempt == self.max_retries:
                return response
            log.warning("%s %s; waiting %.1fs", response.status_code, request.url, delay)
        raise AssertionError("max_retries must be non-negative")

    def _remember(self, url: str, response: httpx.Response) -> None:
        previous = self._cache.pop(url, None)
        if previous is not None:
            self._cache_bytes -= len(previous.content)
        etag = response.headers.get("ETag")
        last_modified = response.headers.get("Last-Modified")
        vary = {
            name.strip().lower()
            for name in response.headers.get("Vary", "").split(",")
            if name.strip()
        }
        size = len(response.content)
        if (
            not self.cache_max_bytes
            or size > self.cache_max_bytes
            or not (etag or last_modified)
            or "*" in vary
        ):
            return
        while self._cache and (
            self._cache_bytes + size > self.cache_max_bytes or len(self._cache) >= MAX_CACHE_ENTRIES
        ):
            _, evicted = self._cache.popitem(last=False)
            self._cache_bytes -= len(evicted.content)
        # HTTPX already decoded the body; replay must describe those decoded bytes.
        headers = dict(response.headers)
        for name in ("content-encoding", "content-length", "transfer-encoding"):
            headers.pop(name, None)
        self._cache[url] = CachedBody(
            etag,
            last_modified,
            response.content,
            headers,
            {name: response.request.headers.get(name) for name in vary},
        )
        self._cache_bytes += size

    def allowed(self, url: str) -> bool:
        parts = urlsplit(url)
        origin = (parts.scheme, parts.netloc)
        entry = self._robots.get(origin)
        if entry is None or self._clock() - entry.fetched_at > self.robots_ttl:
            entry = self._fetch_robots(parts.scheme, parts.netloc)
            self._robots[origin] = entry
            if entry.crawl_delay:
                with self._slot_lock:
                    self._next_slot[parts.netloc] = max(
                        self._next_slot.get(parts.netloc, 0.0), entry.fetched_at + entry.crawl_delay
                    )
        return entry.parser.can_fetch(self.user_agent, url)

    def _fetch_robots(self, scheme: str, host: str) -> RobotsEntry:
        parser = robotparser.RobotFileParser()
        robots_url = urlunsplit((scheme, host, "/robots.txt", "", ""))
        try:
            # Robots redirects define the original host's policy, so they cannot check it yet.
            response = self._get(robots_url, check_robots=False)
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

    def _wait_for_slot(self, url: str) -> None:
        parts = urlsplit(url)
        host = parts.netloc
        entry = self._robots.get((parts.scheme, host))
        interval = max(self.interval, entry.crawl_delay or 0.0) if entry else self.interval
        while True:
            with self._slot_lock:
                now = self._clock()
                cooldown = self._cooldowns.get(host)
                retry_until = cooldown[0] if cooldown else now
                if retry_until - now > self.max_retry_after:
                    raise RetryLater(host, retry_until - now, cooldown[1])
                wait = max(self._next_slot.get(host, now), retry_until) - now
                if wait <= 0:
                    self._next_slot[host] = now + interval
                    return
            # Another response can extend the cooldown while this worker is sleeping.
            self._sleep(wait)
