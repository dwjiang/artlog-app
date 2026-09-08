import fcntl
import json
import math
import os
import re
import time
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlparse

from tavily import TavilyClient

BASE = Path(__file__).resolve().parent
RESULTS = BASE / "results"
BUDGET = 300


def write_json(path, value):
    serialized = json.dumps(value, indent=2, ensure_ascii=False) + "\n"
    key = os.environ.get("TAVILY_API_KEY")
    if key and key in serialized:
        raise RuntimeError("Refusing to persist a response containing the API key")
    temporary = path.with_suffix(".tmp")
    temporary.write_text(serialized)
    temporary.replace(path)


def sentences(text):
    text = " ".join(text.split())
    start = 0
    parts = []
    for boundary in re.finditer(r"[.!?](?:[\"”’])?\s+", text):
        prefix = text[start : boundary.start() + 1]
        if re.search(r"(?:\b[A-Z]|\b(?:Mr|Mrs|Ms|Dr|St)|\b(?:[A-Z]\.)+[A-Z])\.$", prefix):
            continue
        parts.append(text[start : boundary.end()].strip())
        start = boundary.end()
    if text[start:].strip():
        parts.append(text[start:].strip())
    return parts


def first_sentence(text, limit=200):
    parts = sentences(text)
    first = parts[0] if parts else ""
    if len(first) <= limit:
        return first
    truncated = first[: limit - 1].rsplit(" ", 1)[0]
    return truncated.rstrip(".,;:!? ") + "…"


def publication_in_window(value, now):
    if not value:
        return None
    try:
        published = datetime.fromisoformat(value)
    except (ValueError, TypeError):
        try:
            published = parsedate_to_datetime(value)
        except (ValueError, TypeError):
            return False
    if published.tzinfo is None:
        published = published.replace(tzinfo=UTC)
    return now - timedelta(days=31) <= published <= now


def domain_allowed(url, domains):
    host = (urlparse(url).hostname or "").lower()
    return any(host == domain or host.endswith("." + domain) for domain in domains)


def search_metrics(response, now, domains=()):
    answer = response.get("answer") or ""
    results = response.get("results", [])
    top = results[0] if results else {}
    return {
        "answer_present": bool(answer.strip()),
        "answer_chars": len(answer),
        "answer_sentences": len(sentences(answer)),
        "first_sentence": first_sentence(answer),
        "result_count": len(results),
        "top_score": top.get("score"),
        "top_url": top.get("url"),
        "top_published_date": top.get("published_date"),
        "top_in_window": publication_in_window(top.get("published_date"), now),
        "outside_domains": sum(not domain_allowed(r["url"], domains) for r in results)
        if domains
        else None,
    }


def map_metrics(response, params):
    urls = [r if isinstance(r, str) else r["url"] for r in response.get("results", [])]
    host = urlparse(params["url"]).hostname
    matching = sum(
        any(re.search(p, urlparse(url).path) for p in params["select_paths"]) for url in urls
    )
    return {
        "returned": len(urls),
        "unique": len(set(urls)),
        "matching_paths": matching,
        "matching_fraction": matching / len(urls) if urls else None,
        "external_urls": [url for url in urls if urlparse(url).hostname != host],
        "unexpected_paths": [
            url
            for url in urls
            if not any(re.search(p, urlparse(url).path) for p in params["select_paths"])
        ],
    }


def credit_bound(endpoint, params):
    if endpoint == "search":
        if params.get("search_depth") != "basic" or params.get("auto_parameters") is not False:
            raise ValueError(
                "Spike searches must explicitly use basic depth and disable auto parameters"
            )
        return 1
    if endpoint not in {"map", "crawl"}:
        raise ValueError("Unsupported spike endpoint")
    limit = params["limit"]
    if not 1 <= limit <= (20 if endpoint == "crawl" else 2000):
        raise ValueError("Request exceeds the spike page limit")
    cost = math.ceil(limit / 10) * (2 if params.get("instructions") else 1)
    if endpoint == "crawl":
        cost += math.ceil(limit / 5) * (2 if params.get("extract_depth") == "advanced" else 1)
    return cost


def charged_total(results_dir):
    records = [json.loads(path.read_text()) for path in results_dir.glob("*.json")]
    return sum(
        record.get("budget_charge", 0)
        for record in records
        if isinstance(record, dict) and record.get("endpoint") in {"search", "map", "crawl"}
    )


class Evaluation:
    def __init__(self, results_dir=RESULTS, client=None):
        self.results_dir = results_dir
        self.results_dir.mkdir(parents=True, exist_ok=True)
        self.lock = (results_dir.parent / ".run.lock").open("a")
        fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if client is None:
            key = os.environ.get("TAVILY_API_KEY", "").strip()
            if not key:
                raise RuntimeError("TAVILY_API_KEY is required")
            client = TavilyClient(api_key=key)
        self.client = client

    def close(self):
        self.lock.close()

    def run(self, name, endpoint, params, context):
        path = self.results_dir / f"{name}.json"
        if path.exists():
            record = json.loads(path.read_text())
            if record["params"] != params or record["context"] != context:
                raise RuntimeError(f"{name}: saved request differs; do not overwrite evidence")
            if record["status"] != "complete":
                raise RuntimeError(f"{name}: unresolved request; reconcile usage before any retry")
            print(
                f"{name}: saved result; budget total {charged_total(self.results_dir):g}/{BUDGET}",
                flush=True,
            )
            return record
        reserve = credit_bound(endpoint, params)
        total = charged_total(self.results_dir)
        if total + reserve > BUDGET:
            raise RuntimeError(f"Budget exceeded: {total:g} + {reserve} > {BUDGET}")
        now = datetime.now(UTC)
        record = {
            "endpoint": endpoint,
            "params": params,
            "context": context,
            "started_at": now.isoformat(),
            "status": "pending",
            "reserved_credits": reserve,
            "budget_charge": reserve,
        }
        # Reserve before the request so a crash or timeout cannot erase possible spend.
        write_json(path, record)
        started = time.monotonic()
        try:
            response = getattr(self.client, endpoint)(**params)
        except Exception as exc:  # noqa: BLE001 — retain possible spend and omit secret-bearing SDK error text.
            record.update(
                status="error",
                error_type=type(exc).__name__,
                elapsed_seconds=round(time.monotonic() - started, 3),
            )
            write_json(path, record)
            raise RuntimeError(
                f"{name}: {type(exc).__name__}; possible {reserve} credits reserved; no automatic retry"
            ) from None
        credits = response.get("usage", {}).get("credits")
        if not isinstance(credits, (int, float)) or credits < 0 or not math.isfinite(credits):
            credits = None
        record.update(
            status="complete",
            elapsed_seconds=round(time.monotonic() - started, 3),
            response=response,
            reported_credits=credits,
            budget_charge=credits if credits is not None else reserve,
            metrics=search_metrics(response, now, params.get("include_domains", []))
            if endpoint == "search"
            else map_metrics(response, params),
        )
        write_json(path, record)
        print(
            f"{name}: {record['elapsed_seconds']} s; credits {credits}; budget total {charged_total(self.results_dir):g}/{BUDGET}",
            flush=True,
        )
        if credits is None or credits > reserve:
            raise RuntimeError("Unexpected credit report; reconcile usage before continuing")
        return record
