import hashlib
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

import httpx

ROOT = Path(__file__).resolve().parent
UA = os.environ.get(
    "ARTLOG_PROBE_USER_AGENT",
    "artlog-bot/0.1 (+https://github.com/dwjiang/artlog-app; data-source feasibility probe)",
)
BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
)


def now():
    return datetime.now(timezone.utc).isoformat()


def save(name, value):
    path = ROOT / "results" / f"{name}.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
    print(path, flush=True)


class Probe:
    """Bounded, sequential requests; errors are evidence, never a retry loop."""

    def __init__(self, interval=1.1):
        self.interval = interval
        self.last = {}
        self.records = []
        self.blocked_hosts = set()
        self.client = httpx.Client(timeout=65, follow_redirects=False)

    def request(self, url, *, method="GET", ua=UA, headers=None, max_bytes=8_000_000):
        host = urlsplit(url).netloc
        if host in self.blocked_hosts:
            record = {"url": url, "checked_at": now(), "status": None, "error": "Skipped after rate limit; retry on a later run."}
            self.records.append(record)
            return record, ""
        time.sleep(max(0, self.last.get(host, 0) + self.interval - time.monotonic()))
        started = time.monotonic()
        record = {"url": url, "checked_at": now(), "method": method, "user_agent": ua, "status": None}
        self.last[host] = started
        body = bytearray()
        try:
            with self.client.stream(method, url, headers={"User-Agent": ua, **(headers or {})}) as response:
                record.update(
                    status=response.status_code,
                    headers={k: v for k, v in response.headers.items() if k in {
                        "content-type", "content-length", "content-signal", "tdm-reservation",
                        "retry-after", "etag", "last-modified", "location", "server", "content-range",
                    }},
                )
                if response.status_code == 429:
                    self.blocked_hosts.add(host)
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > max_bytes:
                        break
        except httpx.HTTPError as error:
            record["error"] = f"{type(error).__name__}: {error}"
        record.update(
            bytes_read=len(body),
            truncated="error" in record or len(body) > max_bytes,
            sha256=hashlib.sha256(body).hexdigest(),
        )
        text = body.decode("utf-8", errors="replace")
        record["elapsed_seconds"] = round(time.monotonic() - started, 3)
        self.records.append(record)
        print(f"{record['status']} {url[:140]}", flush=True)
        return record, text

    def json(self, url, **kwargs):
        record, body = self.request(url, **kwargs)
        try:
            data = json.loads(body) if record["status"] == 200 and not record["truncated"] else None
        except ValueError:
            data = None
        if data is None:
            record["error_body_excerpt"] = body[:300]
        return record, data
