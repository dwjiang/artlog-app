from protego import Protego

from probe import UA


def robots_policy(record, body, url):
    status = record["status"]
    if status is None or status >= 500:
        return {"verdict": "disallow", "reason": "robots unreachable (RFC 9309 §2.3.1.4)"}
    if status in (401, 403, 429):
        return {"verdict": "hold", "reason": "access/rate block; do not bypass with a browser UA"}
    if status in (404, 410):
        return {"verdict": "not_present", "allowed": True, "crawl_delay": None}
    if status != 200 or record.get("truncated") or "<html" in body.lower() or "<!doctype html" in body.lower():
        return {"verdict": "hold", "reason": "redirect, truncated response, or non-robots content requires review"}
    rules = Protego.parse(body)
    return {
        "verdict": "parsed", "allowed": rules.can_fetch(url, UA),
        "crawl_delay": rules.crawl_delay(UA), "sitemaps": list(rules.sitemaps),
    }
