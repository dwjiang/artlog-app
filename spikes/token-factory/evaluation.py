import argparse
import base64
from collections import defaultdict
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import statistics
import time
import unicodedata

from jsonschema import Draft202012Validator
from openai import APIError, OpenAI

ROOT = Path(__file__).resolve().parent
FIELDS = [
    "title",
    "artist",
    "artist_dates",
    "work_date",
    "medium",
    "accession",
    "credit_line",
]


def read_json(path):
    return json.loads(path.read_text())


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


def field_matches(actual, accepted):
    def normalize(value):
        if value is None:
            return None
        return " ".join(
            unicodedata.normalize("NFKC", value)
            .casefold()
            .translate(str.maketrans({"–": "-", "—": "-", "’": "'"}))
            .split()
        )

    return any(normalize(actual) == normalize(expected) for expected in accepted)


def decode(content, schema):
    try:

        def reject_constant(value):
            raise ValueError(value)

        parsed = json.loads(content or "", parse_constant=reject_constant)
    except (ValueError, TypeError):
        return None, "parse"
    if not Draft202012Validator(schema).is_valid(parsed):
        return None, "schema"
    return parsed, None


def score_docent(sentences, fixture):
    ids = {fact["id"] for fact in fixture["facts"]}
    dropped = sum(
        not sentence["fact_ids"] or not set(sentence["fact_ids"]).issubset(ids)
        for sentence in sentences
    )
    return {"sentences": len(sentences), "dropped": dropped}


def score_factsheet(facts, fixture):
    urls = {source["url"] for source in fixture["sources"]}
    return {
        "facts": len(facts),
        "unknown_urls": sum(fact["sourceUrl"] not in urls for fact in facts),
    }


def token_cost(usage, model):
    return (
        usage["prompt_tokens"] * model["input_per_million"]
        + usage["completion_tokens"] * model["output_per_million"]
    ) / 1_000_000


def reserve(spent, amount, limit):
    if spent + amount > limit:
        raise ValueError("Spike budget exhausted; no request sent")
    return spent + amount


def request_reservation(model, max_tokens, default):
    if "reservation_usd" not in model:
        return default
    amount = model["reservation_usd"]
    maximum_cost = token_cost(
        {"prompt_tokens": model["max_model_len"], "completion_tokens": max_tokens},
        model,
    )
    if not math.isfinite(amount) or amount < maximum_cost:
        raise ValueError("Model reservation must cover its maximum token cost")
    return amount


def client():
    key = os.environ.get("NEBIUS_API_KEY")
    if not key or key == "your-nebius-api-key":
        raise SystemExit("NEBIUS_API_KEY is required in the environment")
    return OpenAI(
        api_key=key,
        base_url=os.environ.get(
            "NEBIUS_BASE_URL", "https://api.tokenfactory.nebius.com/v1/"
        ),
        max_retries=0,
        timeout=180,
    )


def messages_for(suite, fixture, schema, prompt):
    if suite == "label":
        image = (ROOT / "labels" / fixture["file"]).read_bytes()
        if hashlib.sha256(image).hexdigest() != fixture["sha256"]:
            raise ValueError("Label image hash differs from the manifest")
        if len(image) > 1_500_000:
            raise ValueError("Label image exceeds 1.5 MB")
        content = [
            {
                "type": "text",
                "text": "Return JSON matching this schema: " + json.dumps(schema),
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": "data:image/jpeg;base64," + base64.b64encode(image).decode()
                },
            },
        ]
    else:
        payload = (
            fixture["facts"]
            if suite == "docent"
            else fixture["sources"]
            if suite == "factsheet"
            else fixture["text"]
        )
        content = json.dumps({"input": payload, "schema": schema}, ensure_ascii=False)
        if len(content.encode()) > 50_000:
            raise ValueError("Fixture exceeds the spike's input bound")
    return [{"role": "system", "content": prompt}, {"role": "user", "content": content}]


def summarize(suite, records, fixtures, repeats):
    by_id = {fixture["id"]: fixture for fixture in fixtures}
    valid = [row for row in records if row.get("failure") is None]
    latencies = sorted(row["latency_seconds"] for row in records)
    summary = {
        "calls": len(records),
        "valid_outputs": len(valid),
        "parse_failures": sum(row.get("failure") == "parse" for row in records),
        "schema_failures": sum(row.get("failure") == "schema" for row in records),
        "api_failures": sum(row.get("failure") == "api" for row in records),
        "truncated": sum(row.get("finish_reason") == "length" for row in records),
        "estimated_usd": sum(row["estimated_usd"] for row in records),
        "latency_p50_seconds": statistics.median(latencies) if latencies else None,
        "latency_p95_seconds": latencies[max(0, math.ceil(len(latencies) * 0.95) - 1)]
        if latencies
        else None,
    }
    if suite == "label":
        summary["fields"] = {}
        matches = {}
        for row in records:
            fixture = by_id[row["fixture_id"]]
            matches[row["fixture_id"]] = {
                field: row.get("failure") is None
                and field_matches(row["parsed"][field], fixture["expected"][field])
                for field in FIELDS
            }
        for field in FIELDS:
            present = [
                row
                for row in records
                if None not in by_id[row["fixture_id"]]["expected"][field]
            ]
            summary["fields"][field] = {
                "correct": sum(matches[row["fixture_id"]][field] for row in records),
                "total": len(records),
                "printed_correct": sum(
                    matches[row["fixture_id"]][field] for row in present
                ),
                "printed_total": len(present),
            }
        summary["title_artist_both_correct"] = sum(
            value["title"] and value["artist"] for value in matches.values()
        )
        summary["title_artist_field_accuracy"] = (
            (
                summary["fields"]["title"]["correct"]
                + summary["fields"]["artist"]["correct"]
            )
            / (2 * len(records))
            if records
            else None
        )
        named = [
            row
            for row in records
            if None not in by_id[row["fixture_id"]]["expected"]["artist"]
        ]
        summary["named_artist_labels"] = len(named)
        summary["named_title_artist_both_correct"] = sum(
            matches[row["fixture_id"]]["title"] and matches[row["fixture_id"]]["artist"]
            for row in named
        )
    elif suite == "docent":
        scores = [
            score_docent(row["parsed"], by_id[row["fixture_id"]]) for row in valid
        ]
        summary.update(
            {
                key: sum(score[key] for score in scores)
                for key in ["sentences", "dropped"]
            }
        )
        groups = defaultdict(list)
        for row in valid:
            groups[row["fixture_id"]].append(digest(row["parsed"]))
        complete = [values for values in groups.values() if len(values) == repeats]
        summary["complete_repeat_groups"] = len(complete)
        summary["identical_repeat_groups"] = sum(
            len(set(values)) == 1 for values in complete
        )
        summary["sentence_count_violations"] = sum(
            not 3 <= len(row["parsed"]) <= 4 for row in valid
        )
    elif suite == "factsheet":
        scores = [
            score_factsheet(row["parsed"], by_id[row["fixture_id"]]) for row in valid
        ]
        summary.update(
            {
                key: sum(score[key] for score in scores)
                for key in ["facts", "unknown_urls"]
            }
        )
    else:
        for expected in [True, False]:
            group = [
                row
                for row in records
                if by_id[row["fixture_id"]]["flagged"] == expected
            ]
            summary["flagged" if expected else "benign"] = {
                "correct": sum(
                    row.get("failure") is None and row["parsed"]["flagged"] == expected
                    for row in group
                ),
                "total": len(group),
            }
    return summary


def run(suite):
    config = read_json(ROOT / "config.json")
    settings = config["suites"][suite]
    parser = argparse.ArgumentParser(
        description=f"Run the {suite} Token Factory evaluation"
    )
    parser.add_argument("--model", choices=settings["models"])
    parser.add_argument(
        "--mode", choices=["json_schema", "json_object"], default="json_schema"
    )
    parser.add_argument("--limit", type=int)
    parser.add_argument("--tag", default="main")
    parser.add_argument("--score-only", action="store_true")
    parser.add_argument(
        "--default-thinking",
        action="store_true",
        help="Omit the optional chat-template override",
    )
    args = parser.parse_args()
    if not args.tag.replace("-", "").isalnum():
        parser.error("tag must contain letters, numbers or hyphens")
    schema = read_json(ROOT / "schemas" / f"{suite}.json")
    Draft202012Validator.check_schema(schema)
    prompt = (ROOT / "prompts" / f"{suite}.txt").read_text().strip()
    manifest = read_json(ROOT / settings["manifest"])
    fixtures = manifest["cases"][: args.limit]
    results = ROOT / "results"
    results.mkdir(exist_ok=True)
    api = None if args.score_only else client()
    with (results / ".lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        for model_key in [args.model] if args.model else settings["models"]:
            model = config["models"][model_key]
            reservation = request_reservation(
                model, settings["max_tokens"], config["reservation_usd"]
            )
            output = results / f"{suite}-{model_key}-{args.mode}-{args.tag}.json"
            template = (
                None
                if args.default_thinking
                else model.get("chat_template_kwargs", {"enable_thinking": False})
            )
            protocol = {
                "suite": suite,
                "model": model,
                "schema": schema,
                "prompt": prompt,
                "manifest_sha256": digest(manifest),
                "max_tokens": settings["max_tokens"],
                "temperature": 0,
                "chat_template_kwargs": template,
                "response_mode": args.mode,
                "repeats": settings["repeats"],
            }
            report = (
                read_json(output)
                if output.exists()
                else {"protocol": protocol, "records": []}
            )
            if report["protocol"] != protocol:
                raise SystemExit(
                    "Protocol changed: choose a new --tag to preserve the prior results"
                )
            if not args.score_only:
                for fixture in fixtures:
                    for repeat in range(settings["repeats"]):
                        if any(
                            row["fixture_id"] == fixture["id"]
                            and row["repeat"] == repeat
                            for row in report["records"]
                        ):
                            continue
                        messages = messages_for(suite, fixture, schema, prompt)
                        response_format = {"type": args.mode}
                        if args.mode == "json_schema":
                            response_format["json_schema"] = {
                                "name": suite,
                                "strict": True,
                                "schema": schema,
                            }
                        budget_path = results / "budget.json"
                        budget = (
                            read_json(budget_path)
                            if budget_path.exists()
                            else {
                                "estimated_spend_usd": 0.01,
                                "note": "Includes $0.01 conservative allowance for the three credential/format probes.",
                            }
                        )
                        before = budget["estimated_spend_usd"]
                        budget["estimated_spend_usd"] = reserve(
                            before, reservation, config["budget_usd"]
                        )
                        write_json(budget_path, budget)
                        start = time.monotonic()
                        record = {
                            "fixture_id": fixture["id"],
                            "repeat": repeat,
                            "started_at": datetime.now(timezone.utc).isoformat(),
                            "estimated_usd": reservation,
                        }
                        try:
                            response = api.chat.completions.create(
                                model=model["id"],
                                messages=messages,
                                response_format=response_format,
                                temperature=0,
                                max_tokens=settings["max_tokens"],
                                extra_body={"chat_template_kwargs": template}
                                if template is not None
                                else {},
                            )
                            raw = response.model_dump(mode="json")
                            choice = raw["choices"][0]
                            parsed, failure = decode(
                                choice["message"]["content"], schema
                            )
                            record.update(
                                {
                                    "response": raw,
                                    "parsed": parsed,
                                    "failure": failure,
                                    "finish_reason": choice["finish_reason"],
                                }
                            )
                            if raw.get("usage"):
                                record["estimated_usd"] = token_cost(
                                    raw["usage"], model
                                )
                        except APIError as error:
                            status = getattr(error, "status_code", None)
                            record.update(
                                {
                                    "failure": "api",
                                    "error_type": type(error).__name__,
                                    "http_status": status,
                                }
                            )
                            record["error_detail"] = json.dumps(
                                getattr(error, "body", None), ensure_ascii=False
                            ).replace(api.api_key, "[REDACTED]")[:2000]
                            if status in [400, 401, 402, 403, 404, 422, 429]:
                                record["estimated_usd"] = 0
                        record["latency_seconds"] = time.monotonic() - start
                        budget["estimated_spend_usd"] = before + record["estimated_usd"]
                        write_json(budget_path, budget)
                        report["records"].append(record)
                        write_json(output, report)
                        print(
                            f"{suite:10} {model_key:10} {fixture['id']:16} {repeat + 1} {record['failure'] or 'valid':7} {record['latency_seconds']:.2f}s ${record['estimated_usd']:.6f}",
                            flush=True,
                        )
                        if record["failure"] == "api":
                            raise SystemExit(
                                f"API failure recorded (HTTP {record.get('http_status')}); stopped without retry"
                            )
                        if record["estimated_usd"] > reservation:
                            raise SystemExit(
                                "Request exceeded its conservative cost reservation; stopped"
                            )
                        time.sleep(1)
            report["summary"] = summarize(
                suite, report["records"], manifest["cases"], settings["repeats"]
            )
            write_json(output, report)
            print(json.dumps(report["summary"], indent=2), flush=True)
