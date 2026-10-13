# ruff: noqa: N999
import csv
import importlib
import json
from copy import deepcopy

import pytest

audit = importlib.import_module("pipeline.museum-audit")
DEPLOYMENT = "https://audit-dev.convex.cloud"


class Writer:
    def __init__(self, museums):
        self.museums = {row["key"]: deepcopy(row) for row in museums}
        self.writes = []
        self.version = 0
        self.fail_after_commit = False

    def query(self, name, args=None):
        args = args or {}
        if name == "museumAudit:exportPage":
            return {"page": list(self.museums.values()), "isDone": True}
        if name == "museumAudit:byKeys":
            return [deepcopy(self.museums.get(key)) for key in args["keys"]]
        raise AssertionError(name)

    def mutation(self, name, args):
        assert name == "ingest:upsertMuseums"
        assert args["insertOnly"] is True
        self.writes.append((name, deepcopy(args)))
        ids = {}
        for row in args["rows"]:
            if row["key"] in self.museums:
                ids[row["key"]] = self.museums[row["key"]]["_id"]
                continue
            document = {
                **row,
                "_id": "id:" + row["key"],
                "_creationTime": 1,
                "optOut": False,
                "contributionRevision": 0,
            }
            self.museums[row["key"]] = document
            ids[row["key"]] = document["_id"]
            self.version += 1
        return {"ids": ids}

    def action(self, name, args):
        assert name == "museumAudit:applyBatch"
        self.writes.append((name, deepcopy(args)))
        proposed = deepcopy(self.museums)
        changed, ids = 0, {}
        for row in args["records"]:
            stored = proposed[row["key"]]
            merged_into = (
                self.museums[row["duplicateOf"]]["_id"] if row.get("duplicateOf") else None
            )
            ids[row["key"]] = stored["_id"]
            if (stored.get("excludedFromDiscovery", False), stored.get("mergedInto")) != (
                row["excludedFromDiscovery"],
                merged_into,
            ):
                stored["excludedFromDiscovery"] = row["excludedFromDiscovery"]
                if merged_into:
                    stored["mergedInto"] = merged_into
                else:
                    stored.pop("mergedInto", None)
                changed += 1
        by_id = {row["_id"]: row for row in proposed.values()}
        if any(
            by_id[row["mergedInto"]].get("mergedInto")
            for row in proposed.values()
            if row.get("mergedInto")
        ):
            raise ValueError("museum_alias_chain")
        self.museums = proposed
        self.version += changed
        if self.fail_after_commit:
            self.fail_after_commit = False
            raise RuntimeError("lost response")
        return {"changed": changed, "unchanged": len(args["records"]) - changed, "ids": ids}


def museum(key, name="Gallery", lat=40, lng=-73, **fields):
    return {
        "key": key,
        "_id": "id:" + key,
        "_creationTime": 1,
        "name": name,
        "lat": lat,
        "lng": lng,
        "country": "US",
        "region": "country:US",
        "seedSource": "wikidata",
        "optOut": True,
        "contributionRevision": 17,
        "platform": "private-platform",
        **fields,
    }


@pytest.fixture
def source(tmp_path):
    directory = tmp_path / "source"
    directory.mkdir()
    originals = [
        {
            "key": f"wikidata:Q{i}",
            "wikidata_id": f"Q{i}",
            "name": name,
            "country": "US",
            "lat": "40",
            "lng": "-73",
            "website": "",
        }
        for i, name in ((1, "Keep"), (2, "Remove"), (3, "Review"), (4, "Duplicate"))
    ]
    decisions = [
        {
            **{field: row[field] for field in ("key", "wikidata_id", "name", "country")},
            "verdict": verdict,
            "category": category,
            "basis": "read",
            "reason": "Audited",
            "evidence_url": "https://museum.example",
            "duplicate_of": duplicate,
        }
        for row, verdict, category, duplicate in zip(
            originals,
            ["keep", "remove", "review", "remove"],
            ["art_museum", "not_art", "art_museum", "not_a_venue"],
            ["", "", "", "wikidata:Q3"],
            strict=True,
        )
    ]
    additions = [
        {
            "wikidata_id": "",
            "name": 'Musée, "Art"\nGallery',
            "country": "US",
            "city": "New York",
            "lat": "41.25",
            "lng": "-74.5",
            "coord_source": "https://www.wikidata.org/wiki/Q3",
            "website": "",
            "category": "art_museum",
            "why_missing": "no_wikidata_item",
            "source_list_url": "https://en.wikipedia.org/wiki/List_of_museums",
            "evidence_url": "https://museum.example",
        }
    ]
    for name, rows in (
        ("artlog-current-museums.csv", originals),
        ("audit.csv", decisions),
        ("additions.csv", additions),
    ):
        write_csv(directory / name, rows)
    verification = {
        "audit_complete": True,
        "csv_validation": {
            "valid": True,
            "counts": {"input_rows": 4, "audit_rows": 4, "addition_rows": 1},
        },
    }
    (directory / "verification.json").write_text(json.dumps(verification))
    return directory


def write_csv(path, rows):
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def existing_writer():
    return Writer(
        [
            museum(f"wikidata:Q{i}", name)
            for i, name in ((1, "Keep"), (2, "Remove"), (3, "Review"), (4, "Duplicate"))
        ]
        + [museum("poi:unrelated", "Other")]
    )


def run(source, tmp_path, writer, **options):
    return audit.run_import(
        writer,
        audit.load_inputs(source),
        tmp_path / "state",
        deployment_url=DEPLOYMENT,
        target="dev",
        **options,
    )


def test_parse_quoted_unicode_and_newlines_without_borrowing_coordinate_qid(source):
    inputs = audit.load_inputs(source)
    row = inputs.additions[0]
    assert row["name"] == 'Musée, "Art"\nGallery'
    assert row["key"].startswith("museum-audit:")
    assert len(row["key"]) == len("museum-audit:") + 64
    assert "wikidataId" not in row
    assert row["seedSource"] == "manual"
    assert row["key"] == audit.load_inputs(source).additions[0]["key"]


@pytest.mark.parametrize(
    "field,value", [("verdict", "unsure"), ("category", "other"), ("duplicate_of", "wikidata:Q999")]
)
def test_rejects_invalid_audit_contract(source, field, value):
    rows = list(csv.DictReader((source / "audit.csv").open()))
    rows[3][field] = value
    write_csv(source / "audit.csv", rows)
    with pytest.raises(ValueError):
        audit.load_inputs(source)


def test_rejects_out_of_range_coordinates_and_duplicate_graph_cycles(source):
    rows = list(csv.DictReader((source / "additions.csv").open()))
    rows[0]["lat"] = "nan"
    write_csv(source / "additions.csv", rows)
    with pytest.raises(ValueError, match="coordinates"):
        audit.load_inputs(source)
    rows[0]["lat"] = "41.25"
    write_csv(source / "additions.csv", rows)
    decisions = list(csv.DictReader((source / "audit.csv").open()))
    decisions[2].update(verdict="remove", duplicate_of="wikidata:Q4")
    write_csv(source / "audit.csv", decisions)
    with pytest.raises(ValueError, match="cycle"):
        audit.load_inputs(source)


def test_region_and_country_use_existing_seed_contract():
    regions = {"sf-bay-area": {"country": "US", "center": [37.78, -122.4]}}
    row = {
        "key": "wikidata:Q1",
        "wikidata_id": "Q1",
        "name": "Art",
        "lat": "37.78",
        "lng": "-122.4",
        "website": "",
        "country": "US",
    }
    assert audit.museum_row(row, regions)["region"] == "sf-bay-area"
    row["country"] = "DD"
    assert "country" not in audit.museum_row(row, regions)
    assert audit.museum_row(row, regions)["region"] == "country:DD"
    row["country"] = ""
    assert "country" not in audit.museum_row(row, regions)
    assert audit.museum_row(row, regions)["region"] == "country:unknown"


def test_apply_preserves_reviews_ids_private_fields_and_unknown_venues(source, tmp_path):
    writer = existing_writer()
    before = deepcopy(writer.museums)
    result = run(source, tmp_path, writer, apply=True)
    assert result["verified"] is True
    assert writer.museums["wikidata:Q3"] == before["wikidata:Q3"]
    assert writer.museums["poi:unrelated"] == before["poi:unrelated"]
    assert writer.museums["wikidata:Q4"]["mergedInto"] == before["wikidata:Q3"]["_id"]
    assert writer.museums["wikidata:Q2"]["excludedFromDiscovery"] is True
    for key, original in before.items():
        assert writer.museums[key]["_id"] == original["_id"]
        assert writer.museums[key]["platform"] == original["platform"]
        assert writer.museums[key]["optOut"] is True
    backup = json.loads((tmp_path / "state" / "museum-backup.json").read_text())
    assert backup["museums"] == list(before.values())
    version = writer.version
    run(source, tmp_path, writer, apply=True)
    assert writer.version == version


def test_dry_run_reports_missing_and_never_writes_until_explicit_seed(source, tmp_path):
    writer = Writer([])
    report = run(source, tmp_path, writer)
    assert report["missingOriginals"] == 4
    assert report["missingOriginalVerdicts"] == {"keep": 1, "remove": 2, "review": 1}
    assert writer.writes == []
    with pytest.raises(ValueError, match="missing original"):
        run(source, tmp_path, writer, apply=True)
    result = run(source, tmp_path, writer, apply=True, seed_missing_originals=True)
    assert result["verified"] is True
    assert writer.museums["wikidata:Q3"].get("excludedFromDiscovery", False) is False
    assert len(writer.museums) == 5


def test_conflicting_live_named_venue_is_not_silently_duplicated(source, tmp_path):
    inputs = audit.load_inputs(source)
    added = inputs.additions[0]
    writer = existing_writer()
    writer.museums["poi:already-here"] = museum(
        "poi:already-here", added["name"], added["lat"], added["lng"]
    )
    report = run(source, tmp_path, writer)
    assert len(report["identityConflicts"]) == 1
    with pytest.raises(ValueError, match="identity conflict"):
        run(source, tmp_path, writer, apply=True)
    assert not writer.writes


def test_checkpoint_refuses_different_target_and_changed_source(source, tmp_path):
    writer = existing_writer()
    run(source, tmp_path, writer)
    with pytest.raises(ValueError, match="binding"):
        audit.run_import(
            writer,
            audit.load_inputs(source),
            tmp_path / "state",
            deployment_url="https://audit-prod.convex.cloud",
            target="prod",
        )
    rows = list(csv.DictReader((source / "audit.csv").open()))
    rows[0]["reason"] = "Changed source"
    write_csv(source / "audit.csv", rows)
    with pytest.raises(ValueError, match="binding"):
        run(source, tmp_path, writer, apply=True)
    assert not writer.writes


def test_resume_after_lost_response_does_not_increment_changes_twice(source, tmp_path):
    writer = existing_writer()
    writer.fail_after_commit = True
    with pytest.raises(RuntimeError, match="lost response"):
        run(source, tmp_path, writer, apply=True)
    version = writer.version
    result = run(source, tmp_path, writer, apply=True)
    assert result["verified"] is True
    assert writer.version == version


def test_verify_detects_deleted_venue_or_changed_review(source, tmp_path):
    writer = existing_writer()
    run(source, tmp_path, writer, apply=True)
    writer.museums["wikidata:Q3"]["name"] = "Changed review"
    with pytest.raises(ValueError, match="preserved"):
        run(source, tmp_path, writer, verify_only=True)
    writer.museums.pop("wikidata:Q2")
    with pytest.raises(ValueError):
        run(source, tmp_path, writer, verify_only=True)


def test_matching_live_addition_keeps_its_name_metadata_and_id(source, tmp_path):
    writer = existing_writer()
    added = audit.load_inputs(source).additions[0]
    old = museum(added["key"], "Localized existing name", added["lat"], added["lng"])
    writer.museums[added["key"]] = deepcopy(old)
    result = run(source, tmp_path, writer, apply=True)
    assert result["verified"] is True
    assert writer.museums[added["key"]] == old
    assert all(name != "ingest:upsertMuseums" for name, _ in writer.writes)


def test_hidden_matching_addition_and_merged_review_target_block_all_writes(source, tmp_path):
    writer = existing_writer()
    added = audit.load_inputs(source).additions[0]
    writer.museums[added["key"]] = museum(added["key"], excludedFromDiscovery=True)
    with pytest.raises(ValueError, match="identity conflict"):
        run(source, tmp_path, writer, apply=True)
    assert not writer.writes
    writer.museums.pop(added["key"])
    writer.museums["wikidata:Q3"]["mergedInto"] = writer.museums["wikidata:Q1"]["_id"]
    with pytest.raises(ValueError, match="identity conflict"):
        run(source, tmp_path, writer, apply=True)
    assert not writer.writes


def test_sources_changed_during_live_preflight_are_rejected_before_mutations(source, tmp_path):
    inputs = audit.load_inputs(source)
    writer = existing_writer()
    rows = list(csv.DictReader((source / "audit.csv").open()))
    rows[0]["reason"] = "Changed after load"
    write_csv(source / "audit.csv", rows)
    with pytest.raises(ValueError, match="inputs changed"):
        audit.run_import(
            writer, inputs, tmp_path / "state", deployment_url=DEPLOYMENT, target="dev", apply=True
        )
    assert not writer.writes


def test_resume_refuses_altered_backup_bytes(source, tmp_path):
    writer = existing_writer()
    run(source, tmp_path, writer, apply=True)
    path = tmp_path / "state" / "museum-backup.json"
    path.write_text(path.read_text() + "\n")
    with pytest.raises(ValueError, match="backup.*bytes changed"):
        run(source, tmp_path, writer, apply=True)


def test_insert_only_preserves_a_museum_created_between_lookup_and_write(source, tmp_path):
    writer = existing_writer()
    added = audit.load_inputs(source).additions[0]
    original_mutation = writer.mutation

    def race(name, args):
        writer.museums[added["key"]] = museum(added["key"], "Concurrent independent name")
        return original_mutation(name, args)

    writer.mutation = race
    with pytest.raises(ValueError, match="inserted museum metadata differs"):
        run(source, tmp_path, writer, apply=True)
    assert writer.museums[added["key"]]["name"] == "Concurrent independent name"
    assert writer.museums[added["key"]]["platform"] == "private-platform"


def test_duplicate_chain_resolves_to_terminal_and_updates_terminals_first(source):
    rows = list(csv.DictReader((source / "audit.csv").open()))
    rows[1].update(duplicate_of="wikidata:Q3")
    rows[3].update(duplicate_of="wikidata:Q2")
    write_csv(source / "audit.csv", rows)
    records = audit.decision_records(audit.load_inputs(source))
    assert records[0]["key"] == "wikidata:Q1"
    assert records[1]["duplicateOf"] == "wikidata:Q3"
    assert records[2]["duplicateOf"] == "wikidata:Q3"


@pytest.mark.parametrize("lost_response", [False, True])
@pytest.mark.parametrize("restore_target", [False, True])
def test_redirects_existing_aliases_before_merging_survivors_across_batches(
    source, tmp_path, lost_response, restore_target
):
    originals = list(csv.DictReader((source / "artlog-current-museums.csv").open()))
    decisions = list(csv.DictReader((source / "audit.csv").open()))
    decisions[0].update(verdict="remove", duplicate_of="wikidata:Q3")
    writer = existing_writer()
    writer.museums["wikidata:Q4"].update(
        excludedFromDiscovery=True, mergedInto=writer.museums["wikidata:Q1"]["_id"]
    )
    if restore_target:
        decisions[2]["verdict"] = "keep"
        writer.museums["wikidata:Q3"].update(
            excludedFromDiscovery=True, mergedInto=writer.museums["wikidata:Q2"]["_id"]
        )
    for i in range(1000, 1498 - int(restore_target)):
        key = f"wikidata:Q{i}"
        originals.append({**originals[0], "key": key, "wikidata_id": f"Q{i}"})
        decisions.append({**decisions[0], "key": key, "wikidata_id": f"Q{i}"})
        writer.museums[key] = museum(key)
    write_csv(source / "artlog-current-museums.csv", originals)
    write_csv(source / "audit.csv", decisions)
    verification_path = source / "verification.json"
    verification = json.loads(verification_path.read_text())
    verification["csv_validation"]["counts"].update(
        input_rows=len(originals), audit_rows=len(decisions)
    )
    verification_path.write_text(json.dumps(verification))
    assert run(source, tmp_path, writer)["originalDecisionsToChange"] == 501

    writer.fail_after_commit = lost_response
    if lost_response:
        with pytest.raises(RuntimeError, match="lost response"):
            run(source, tmp_path, writer, apply=True)
    assert run(source, tmp_path, writer, apply=True)["verified"] is True
    batches = [args["records"] for name, args in writer.writes if name == "museumAudit:applyBatch"]
    assert [len(batch) for batch in batches] == [500, 1]
    destination = writer.museums["wikidata:Q3"]
    assert "mergedInto" not in destination
    for key in ("wikidata:Q1", "wikidata:Q4"):
        assert writer.museums[key]["mergedInto"] == destination["_id"]
    version = writer.version
    assert run(source, tmp_path, writer, apply=True)["verified"] is True
    assert writer.version == version


def test_dotenv_credentials_are_target_bound_and_do_not_mutate_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("CONVEX_DEPLOY_KEY", "ambient-wrong-key")
    credential = tmp_path / "production.env"
    credential.write_text(
        'CONVEX_URL="https://audit-prod.convex.cloud"\nCONVEX_DEPLOY_KEY="prod:audit-prod|test-only"\n'
    )
    assert (
        audit.read_admin_key(
            credential, deployment_url="https://audit-prod.convex.cloud", target="prod"
        )
        == "prod:audit-prod|test-only"
    )
    with pytest.raises(ValueError, match="URL differs"):
        audit.read_admin_key(credential, deployment_url=DEPLOYMENT, target="dev")
    with pytest.raises(ValueError, match="explicit target"):
        audit.read_admin_key(
            credential, deployment_url="https://audit-prod.convex.cloud", target="dev"
        )
    credential.write_text(
        "CONVEX_URL=https://audit-prod.convex.cloud\nCONVEX_DEPLOY_KEY=${CONVEX_DEPLOY_KEY}\n"
    )
    with pytest.raises(ValueError, match="explicit deployment credentials"):
        audit.read_admin_key(
            credential, deployment_url="https://audit-prod.convex.cloud", target="prod"
        )


def test_raw_admin_key_rejects_wrong_deployment(tmp_path):
    credential = tmp_path / "raw-key"
    credential.write_text("prod:audit-prod|test-only\n")
    assert (
        audit.read_admin_key(
            credential, deployment_url="https://audit-prod.convex.cloud", target="prod"
        )
        == "prod:audit-prod|test-only"
    )
    with pytest.raises(ValueError, match="explicit target"):
        audit.read_admin_key(credential, deployment_url=DEPLOYMENT, target="prod")
