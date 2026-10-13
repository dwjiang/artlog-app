# ruff: noqa: N999
import argparse
import csv
import fcntl
import hashlib
import io
import json
import math
import os
import re
import unicodedata
from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from dotenv import dotenv_values

from .config import Settings
from .convex_writer import ConvexWriter
from .model_version import REPO_ROOT
from .regions import load_regions, region_for
from .seed_venues import COUNTRY_CODES
from .wikidata import MAX_VENUES, VenueRow, distance_km

VERDICTS = {"keep", "remove", "review"}
CATEGORIES = {
    "art_museum",
    "art_center",
    "art_collection_in_other_museum",
    "artist_house",
    "sculpture_park",
    "commercial_gallery",
    "antiquities_or_ethnography",
    "not_art",
    "not_a_venue",
}
SOURCE_COLUMNS = {
    "artlog-current-museums.csv": {
        "key",
        "wikidata_id",
        "name",
        "country",
        "lat",
        "lng",
        "website",
    },
    "audit.csv": {
        "key",
        "wikidata_id",
        "name",
        "country",
        "verdict",
        "category",
        "basis",
        "reason",
        "evidence_url",
        "duplicate_of",
    },
    "additions.csv": {
        "wikidata_id",
        "name",
        "country",
        "city",
        "lat",
        "lng",
        "coord_source",
        "website",
        "category",
        "why_missing",
        "source_list_url",
        "evidence_url",
    },
}
AUDIT_FIELDS = {"excludedFromDiscovery", "mergedInto"}
DEFAULT_SOURCE = REPO_ROOT / ".context" / "museum-audit"


@dataclass(frozen=True)
class AuditInputs:
    originals: dict[str, dict]
    decisions: dict[str, dict]
    additions: list[dict]
    binding: dict
    source: Path


def digest_file(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def digest_json(value: Any) -> str:
    content = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def normalized_name(value: str) -> str:
    return unicodedata.normalize("NFKC", value).strip().casefold()


def read_rows(source: Path, filename: str) -> list[dict]:
    with (source / filename).open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if set(reader.fieldnames or ()) != SOURCE_COLUMNS[filename] or len(
            reader.fieldnames or ()
        ) != len(SOURCE_COLUMNS[filename]):
            raise ValueError(f"Invalid columns in {filename}")
        rows = list(reader)
    if any(None in row or any(value is None for value in row.values()) for row in rows):
        raise ValueError(f"Malformed CSV rows in {filename}")
    return rows


def validated_coords(row: Mapping) -> tuple[float, float]:
    try:
        lat, lng = float(row["lat"]), float(row["lng"])
    except (TypeError, ValueError) as error:
        raise ValueError("Invalid museum coordinates") from error
    if (
        not math.isfinite(lat)
        or not math.isfinite(lng)
        or not -90 <= lat <= 90
        or not -180 <= lng <= 180
    ):
        raise ValueError("Invalid museum coordinates")
    return lat, lng


def valid_qid(qid: str) -> bool:
    return re.fullmatch(r"Q[1-9][0-9]*", qid) is not None


def addition_key(row: Mapping) -> str:
    if row["wikidata_id"]:
        if not valid_qid(row["wikidata_id"]):
            raise ValueError("Invalid addition QID")
        return "wikidata:" + row["wikidata_id"]
    identity = [row[field] for field in ("country", "name", "lat", "lng")]
    return "museum-audit:" + digest_json(identity)


def museum_row(row: Mapping, regions: Mapping) -> dict:
    lat, lng = validated_coords(row)
    country = row["country"]
    qid = row.get("wikidata_id", "")
    venue = VenueRow(qid, row["name"], lat, lng, row.get("website") or None, country or "unknown")
    return {
        "key": row.get("key") or addition_key(row),
        "name": row["name"],
        "lat": lat,
        "lng": lng,
        "region": region_for(venue, regions),
        "seedSource": "wikidata" if qid else "manual",
        **({"wikidataId": qid} if qid else {}),
        **({"country": country} if country in COUNTRY_CODES else {}),
        **({"website": row["website"]} if row.get("website") else {}),
        **({"city": row["city"]} if row.get("city") else {}),
    }


def load_inputs(source: Path) -> AuditInputs:
    source = Path(source)
    source_sha = {
        filename: digest_file(source / filename)
        for filename in (*SOURCE_COLUMNS, "verification.json")
    }
    original_rows = read_rows(source, "artlog-current-museums.csv")
    audit_rows = read_rows(source, "audit.csv")
    addition_rows = read_rows(source, "additions.csv")
    originals = {row["key"]: row for row in original_rows}
    decisions = {row["key"]: row for row in audit_rows}
    if (
        len(originals) != len(original_rows)
        or len(decisions) != len(audit_rows)
        or set(originals) != set(decisions)
    ):
        raise ValueError("Duplicate original keys or incomplete audit coverage")
    if not originals:
        raise ValueError("Refusing an empty museum audit")
    for key, row in originals.items():
        if not valid_qid(row["wikidata_id"]) or key != "wikidata:" + row["wikidata_id"]:
            raise ValueError("Invalid original identity")
        if not row["name"].strip():
            raise ValueError("Missing original name")
        validated_coords(row)
    for key, row in decisions.items():
        if (
            row["wikidata_id"] != originals[key]["wikidata_id"]
            or row["verdict"] not in VERDICTS
            or row["category"] not in CATEGORIES
        ):
            raise ValueError("Invalid audit decision")
        if row["duplicate_of"] and row["verdict"] != "remove":
            raise ValueError("A duplicate must be removed")
        seen, target = {key}, row["duplicate_of"]
        while target:
            if target in seen:
                raise ValueError("Duplicate identity cycle")
            if target not in decisions:
                raise ValueError("Missing duplicate identity target")
            seen.add(target)
            target = decisions[target]["duplicate_of"]
    regions = load_regions()
    additions, addition_keys = [], set()
    for row in addition_rows:
        if row["country"] not in COUNTRY_CODES or row["category"] not in CATEGORIES - {
            "not_art",
            "not_a_venue",
        }:
            raise ValueError("Invalid addition country or category")
        if (
            not row["name"].strip()
            or not row["coord_source"].strip()
            or not row["evidence_url"].strip()
            or not row["source_list_url"].strip()
        ):
            raise ValueError("Missing addition evidence or name")
        prepared = museum_row(row, regions)
        if prepared["key"] in originals or prepared["key"] in addition_keys:
            raise ValueError("Duplicate addition identity or overlap with originals")
        addition_keys.add(prepared["key"])
        additions.append(prepared)
    verification_path = source / "verification.json"
    verification = json.loads(verification_path.read_text())
    counts = verification["csv_validation"]["counts"]
    if (
        not verification["audit_complete"]
        or not verification["csv_validation"]["valid"]
        or any(
            counts[field] != expected
            for field, expected in (
                ("input_rows", len(originals)),
                ("audit_rows", len(decisions)),
                ("addition_rows", len(additions)),
            )
        )
    ):
        raise ValueError("Source completion verification does not match CSV files")
    if any(digest_file(source / filename) != digest for filename, digest in source_sha.items()):
        raise ValueError("Museum audit sources changed while parsing")
    binding = {
        "sourceSha256": source_sha,
        "regionConfigSha256": digest_file(REPO_ROOT / "shared/sources/regions.json"),
        "countryConfigSha256": digest_file(REPO_ROOT / "shared/journal/countries.json"),
    }
    binding["inputSha256"] = digest_json(binding)
    return AuditInputs(originals, decisions, additions, binding, source)


def require_current_inputs(inputs: AuditInputs) -> None:
    if (
        any(
            digest_file(inputs.source / filename) != digest
            for filename, digest in inputs.binding["sourceSha256"].items()
        )
        or digest_file(REPO_ROOT / "shared/sources/regions.json")
        != inputs.binding["regionConfigSha256"]
        or digest_file(REPO_ROOT / "shared/journal/countries.json")
        != inputs.binding["countryConfigSha256"]
    ):
        raise ValueError("Museum audit inputs changed after preflight")


def write_json(path: Path, value: Any) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def export_museums(writer) -> list[dict]:
    rows, keys, ids, seen_cursors = [], set(), set(), set()
    cursor = None
    while True:
        page = writer.query("museumAudit:exportPage", {"cursor": cursor} if cursor else {})
        for row in page["page"]:
            if row["key"] in keys or row["_id"] in ids:
                raise ValueError("Duplicate keys or IDs in museum export")
            keys.add(row["key"])
            ids.add(row["_id"])
            rows.append(row)
        if len(rows) > MAX_VENUES:
            raise ValueError("Museum export exceeded venue limit")
        if page["isDone"]:
            return rows
        cursor = page.get("continueCursor")
        if not cursor or cursor in seen_cursors:
            raise ValueError("Museum export pagination did not advance")
        seen_cursors.add(cursor)


def terminal_target(inputs: AuditInputs, key: str) -> str | None:
    target = inputs.decisions[key]["duplicate_of"]
    if not target:
        return None
    while inputs.decisions[target]["duplicate_of"]:
        target = inputs.decisions[target]["duplicate_of"]
    return target


def decision_records(inputs: AuditInputs) -> list[dict]:
    rows = []
    for key, decision in sorted(inputs.decisions.items()):
        if decision["verdict"] == "review":
            continue
        target = terminal_target(inputs, key)
        rows.append(
            {
                "key": key,
                "excludedFromDiscovery": decision["verdict"] == "remove",
                **({"duplicateOf": target} if target else {}),
            }
        )
    return sorted(rows, key=lambda row: bool(row.get("duplicateOf")))


def expected_audit_state(record: Mapping, live: Mapping[str, dict]) -> tuple[bool, str | None]:
    target = record.get("duplicateOf")
    return record["excludedFromDiscovery"], live[target]["_id"] if target else None


def actual_audit_state(museum: Mapping) -> tuple[bool, str | None]:
    return museum.get("excludedFromDiscovery", False), museum.get("mergedInto")


def preview(
    inputs: AuditInputs, live_rows: Sequence[dict], *, seed_missing_originals: bool
) -> dict:
    live = {row["key"]: row for row in live_rows}
    missing = sorted(set(inputs.originals) - set(live))
    named = defaultdict(list)
    for row in live_rows:
        named[normalized_name(row["name"])].append(row)
    conflicts = []
    for addition in inputs.additions:
        for row in named[normalized_name(addition["name"])]:
            if (
                row["key"] != addition["key"]
                and distance_km(addition["lat"], addition["lng"], [row["lat"], row["lng"]]) <= 1
            ):
                conflicts.append(
                    {
                        "additionKey": addition["key"],
                        "existingKey": row["key"],
                        "reason": "same_named_venue_within_1km",
                    }
                )
        old = live.get(addition["key"])
        if old and (old.get("excludedFromDiscovery", False) or old.get("mergedInto")):
            conflicts.append(
                {
                    "additionKey": addition["key"],
                    "existingKey": old["key"],
                    "reason": "matching_addition_is_hidden_or_merged",
                }
            )
    records = decision_records(inputs)
    for record in records:
        target = record.get("duplicateOf")
        if (
            target
            and inputs.decisions[target]["verdict"] == "review"
            and live.get(target, {}).get("mergedInto")
        ):
            conflicts.append(
                {
                    "additionKey": None,
                    "existingKey": target,
                    "reason": "preserved_review_duplicate_target_is_merged",
                }
            )
    pending = [
        row
        for row in records
        if row["key"] in live
        and (not row.get("duplicateOf") or row["duplicateOf"] in live)
        and actual_audit_state(live[row["key"]]) != expected_audit_state(row, live)
    ]
    return {
        "inputSha256": inputs.binding["inputSha256"],
        "liveMuseums": len(live),
        "originalRows": len(inputs.originals),
        "originalVerdicts": dict(Counter(row["verdict"] for row in inputs.decisions.values())),
        "missingOriginals": len(missing),
        "missingOriginalKeys": missing,
        "missingOriginalVerdicts": dict(
            Counter(inputs.decisions[key]["verdict"] for key in missing)
        ),
        "originalsToInsert": len(missing) if seed_missing_originals else 0,
        "additions": len(inputs.additions),
        "additionsToInsert": sum(row["key"] not in live for row in inputs.additions),
        "matchingExistingAdditions": sum(row["key"] in live for row in inputs.additions),
        "originalDecisionsToChange": len(pending),
        "duplicateLinks": sum(bool(row.get("duplicateOf")) for row in records),
        "duplicateTerminalVerdicts": dict(
            Counter(
                inputs.decisions[row["duplicateOf"]]["verdict"]
                for row in records
                if row.get("duplicateOf")
            )
        ),
        "existingReviewsPreserved": sum(
            row["verdict"] == "review" and key in live for key, row in inputs.decisions.items()
        ),
        "unknownLiveKeysPreserved": len(
            set(live) - set(inputs.originals) - {row["key"] for row in inputs.additions}
        ),
        "identityConflicts": conflicts,
        "canApply": not conflicts and (not missing or seed_missing_originals),
    }


def require_safe_preview(report: Mapping) -> None:
    if report["identityConflicts"]:
        raise ValueError("Museum identity conflict; inspect dry-run.json")
    if report["missingOriginals"] and not report["canApply"]:
        raise ValueError(
            "Deployment has missing original museums; explicit --seed-missing-originals is required"
        )


def verify_preserved_metadata(
    inputs: AuditInputs, baseline: Sequence[dict], current: Sequence[dict]
) -> None:
    before, after = {row["key"]: row for row in baseline}, {row["key"]: row for row in current}
    for key, old in before.items():
        if key not in after:
            raise ValueError("Verification failed: preserved museum is missing")
        actual = after[key]
        decision = inputs.decisions.get(key)
        ignored = AUDIT_FIELDS if decision and decision["verdict"] != "review" else set()
        if {field: value for field, value in old.items() if field not in ignored} != {
            field: value for field, value in actual.items() if field not in ignored
        }:
            raise ValueError(f"Verification failed: preserved museum metadata changed for {key}")


def verify_museums(inputs: AuditInputs, baseline: Sequence[dict], current: Sequence[dict]) -> dict:
    before, after = {row["key"]: row for row in baseline}, {row["key"]: row for row in current}
    expected_keys = set(inputs.originals) | {row["key"] for row in inputs.additions} | set(before)
    if not expected_keys.issubset(after):
        raise ValueError("Verification failed: missing original, addition or preserved museum")
    verify_preserved_metadata(inputs, baseline, current)
    for record in decision_records(inputs):
        if actual_audit_state(after[record["key"]]) != expected_audit_state(record, after):
            raise ValueError(f"Verification failed: incorrect audit state for {record['key']}")
    regions = load_regions()
    seeded = [
        museum_row(row, regions) for key, row in inputs.originals.items() if key not in before
    ]
    seeded.extend(row for row in inputs.additions if row["key"] not in before)
    for row in seeded:
        if any(after[row["key"]].get(field) != value for field, value in row.items()):
            raise ValueError(
                f"Verification failed: inserted museum metadata differs for {row['key']}"
            )
        if (
            after[row["key"]].get("optOut") is not False
            or after[row["key"]].get("contributionRevision") != 0
        ):
            raise ValueError(
                f"Verification failed: inserted museum defaults differ for {row['key']}"
            )
    for key, row in inputs.decisions.items():
        if (
            row["verdict"] == "review"
            and key not in before
            and actual_audit_state(after[key]) != (False, None)
        ):
            raise ValueError("Verification failed: new review state changed")
    return {
        "verified": True,
        "verifiedMuseums": len(expected_keys),
        "originalRows": len(inputs.originals),
        "additionRows": len(inputs.additions),
        "preservedMuseumIds": len(before),
        "preservedExistingReviews": sum(
            row["verdict"] == "review" and key in before for key, row in inputs.decisions.items()
        ),
        "hardDeletes": 0,
    }


def lookup(writer, keys: Sequence[str]) -> list[dict | None]:
    rows = writer.query("museumAudit:byKeys", {"keys": list(keys)})
    if len(rows) != len(keys) or any(
        row and row["key"] != key for key, row in zip(keys, rows, strict=True)
    ):
        raise ValueError("Museum lookup did not return ordered requested keys")
    return rows


def _run_import(
    writer,
    inputs: AuditInputs,
    directory: Path,
    *,
    deployment_url: str,
    target: str,
    apply: bool,
    seed_missing_originals: bool,
    verify_only: bool,
) -> dict:
    binding = {**inputs.binding, "deploymentUrl": deployment_url, "target": target}
    checkpoint_path = directory / "checkpoint.json"
    checkpoint = (
        json.loads(checkpoint_path.read_text())
        if checkpoint_path.exists()
        else {
            "binding": binding,
            "insertedKeys": [],
            "decisionKeys": [],
            "changed": 0,
            "unchanged": 0,
        }
    )
    if checkpoint["binding"] != binding:
        raise ValueError(
            "Checkpoint binding differs from target or input sources; use a separate work directory"
        )
    write_json(checkpoint_path, checkpoint)
    backup_path = directory / "museum-backup.json"
    backup = json.loads(backup_path.read_text()) if backup_path.exists() else None
    if checkpoint.get("backupSha256") and (
        not backup or digest_file(backup_path) != checkpoint["backupSha256"]
    ):
        raise ValueError("Museum backup is missing or its bytes changed")
    if backup and backup["binding"] != binding:
        raise ValueError("Museum backup binding differs from target or input sources")
    if backup and not checkpoint.get("backupSha256"):
        checkpoint["backupSha256"] = digest_file(backup_path)
        write_json(checkpoint_path, checkpoint)
    current = export_museums(writer)
    report = {
        "deploymentUrl": deployment_url,
        "target": target,
        **preview(inputs, current, seed_missing_originals=seed_missing_originals),
    }
    write_json(directory / "dry-run.json", report)
    if verify_only:
        if not backup:
            raise ValueError("Verification requires the original museum backup")
        verified = verify_museums(inputs, backup["museums"], current)
        write_json(directory / "verification.json", {**binding, **verified})
        return {**report, **verified}
    if not apply:
        return report
    require_safe_preview(report)
    require_current_inputs(inputs)
    if backup is None:
        backup = {"binding": binding, "museums": current}
        write_json(backup_path, backup)
        checkpoint["backupSha256"] = digest_file(backup_path)
        write_json(checkpoint_path, checkpoint)
    else:
        verify_preserved_metadata(inputs, backup["museums"], current)
    live = {row["key"]: row for row in current}
    regions = load_regions()
    rows_to_insert = (
        [museum_row(row, regions) for key, row in inputs.originals.items() if key not in live]
        if seed_missing_originals
        else []
    )
    rows_to_insert.extend(row for row in inputs.additions if row["key"] not in live)
    for start in range(0, len(rows_to_insert), 100):
        candidates = rows_to_insert[start : start + 100]
        old = lookup(writer, [row["key"] for row in candidates])
        missing = [row for row, existing in zip(candidates, old, strict=True) if existing is None]
        if missing:
            result = writer.mutation("ingest:upsertMuseums", {"rows": missing, "insertOnly": True})
            if set(result["ids"]) != {row["key"] for row in missing}:
                raise ValueError("Museum insertion did not acknowledge every key")
        checkpoint["insertedKeys"] = sorted(
            set(checkpoint["insertedKeys"]) | {row["key"] for row in candidates}
        )
        write_json(checkpoint_path, checkpoint)
    live = {row["key"]: row for row in export_museums(writer)}
    records = [
        row
        for row in decision_records(inputs)
        if actual_audit_state(live[row["key"]]) != expected_audit_state(row, live)
    ]
    for start in range(0, len(records), 500):
        batch = records[start : start + 500]
        result = writer.action("museumAudit:applyBatch", {"records": batch})
        if set(result["ids"]) != {row["key"] for row in batch} or result["changed"] + result[
            "unchanged"
        ] != len(batch):
            raise ValueError("Museum audit update did not acknowledge every key")
        checkpoint["decisionKeys"] = sorted(
            set(checkpoint["decisionKeys"]) | {row["key"] for row in batch}
        )
        checkpoint["changed"] += result["changed"]
        checkpoint["unchanged"] += result["unchanged"]
        write_json(checkpoint_path, checkpoint)
    verified = verify_museums(inputs, backup["museums"], export_museums(writer))
    checkpoint["verified"] = True
    write_json(checkpoint_path, checkpoint)
    write_json(directory / "verification.json", {**binding, **verified})
    return {**report, **verified, "acknowledgedChanges": checkpoint["changed"]}


def run_import(
    writer,
    inputs: AuditInputs,
    directory: Path,
    *,
    deployment_url: str,
    target: str,
    apply: bool = False,
    seed_missing_originals: bool = False,
    verify_only: bool = False,
) -> dict:
    if apply and verify_only:
        raise ValueError("Choose apply or verify-only")
    parsed = urlparse(deployment_url)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("An explicit HTTPS deployment URL is required")
    if target not in ("dev", "preview", "prod"):
        raise ValueError("Target must be dev, preview or prod")
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / "import.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("Another museum importer is running for this target") from error
        return _run_import(
            writer,
            inputs,
            directory,
            deployment_url=deployment_url.rstrip("/"),
            target=target,
            apply=apply,
            seed_missing_originals=seed_missing_originals,
            verify_only=verify_only,
        )


def read_admin_key(path: Path, *, deployment_url: str, target: str) -> str:
    content = path.read_text().strip()
    if re.search(r"(?m)^\s*(?:export\s+)?CONVEX_(?:DEPLOY_KEY|URL)\s*=", content):
        values = dotenv_values(stream=io.StringIO(content), interpolate=False)
        key = (values.get("CONVEX_DEPLOY_KEY") or "").strip()
        configured_url = values.get("CONVEX_URL") or ""
        if configured_url.rstrip("/") != deployment_url.rstrip("/"):
            raise ValueError("Credential file URL differs from the explicit deployment URL")
    else:
        key = content
    if not key or "\n" in key or "${" in key:
        raise ValueError("Admin key file must contain a raw key or explicit deployment credentials")
    deployment = re.fullmatch(r"(dev|preview|prod):([a-z0-9-]+)", key.partition("|")[0])
    if deployment and (
        deployment[1] != target
        or urlparse(deployment_url).hostname != deployment[2] + ".convex.cloud"
    ):
        raise ValueError("Admin key deployment differs from the explicit target")
    return key


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Preview or apply the museum audit while preserving venue IDs and history"
    )
    parser.add_argument("--deployment-url", required=True)
    parser.add_argument("--target", choices=("dev", "preview", "prod"), required=True)
    parser.add_argument("--admin-key-file", type=Path, required=True)
    parser.add_argument("--source-dir", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--work-dir", type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--verify-only", action="store_true")
    parser.add_argument("--seed-missing-originals", action="store_true")
    args = parser.parse_args(argv)
    inputs = load_inputs(args.source_dir)
    key = read_admin_key(
        args.admin_key_file, deployment_url=args.deployment_url, target=args.target
    )
    settings = Settings(_env_file=None, convex_url=args.deployment_url, convex_deploy_key=key)
    directory = args.work_dir or DEFAULT_SOURCE / "app-import" / (
        urlparse(args.deployment_url).hostname or "invalid"
    )
    with ConvexWriter(settings) as writer:
        report = run_import(
            writer,
            inputs,
            directory,
            deployment_url=args.deployment_url,
            target=args.target,
            apply=args.apply,
            seed_missing_originals=args.seed_missing_originals,
            verify_only=args.verify_only,
        )
    print(
        json.dumps(
            {
                key: value
                for key, value in report.items()
                if key not in ("missingOriginalKeys", "identityConflicts")
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
