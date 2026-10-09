"""Finds imported Wikidata objects whose owner the current owner map now resolves.

Imports never rewrite imported rows, so an owner learned later (such as a museum department now mapped
to its museum) reaches the deployment as an owner correction that `dedupe --owner-corrections` packages.
"""

import argparse
import json
import logging
from collections.abc import Iterable, Iterator
from pathlib import Path

from .config import get_settings, setup_logging
from .features import read_jsonl, write_jsonl
from .owner_map import OwnerMap
from .sources import wikidata_artworks

log = logging.getLogger(__name__)


def corrections(
    bindings: Iterable[list[dict]], imported: dict[str, dict], owners: OwnerMap, wanted: set[str]
) -> Iterator[dict]:
    """Imported rows that had no owner, with the owner the Wikidata records now give them."""
    for slice_bindings in bindings:
        for _, obj, _ in wikidata_artworks.iter_records(slice_bindings, owners=owners):
            row = imported.get(obj.key)
            if row and not row.get("ownerKey") and obj.ownerKey in wanted:
                yield {**row, "ownerKey": obj.ownerKey}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dumps", type=Path, required=True, help="Wikidata snapshot directory")
    parser.add_argument("--venues", type=Path, required=True, help="JSON array of museum keys")
    parser.add_argument(
        "--imported", type=Path, action="append", required=True, help="objects.jsonl, repeatable"
    )
    parser.add_argument(
        "--owner", action="append", required=True, help="museum key whose objects to correct"
    )
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    setup_logging(get_settings())
    manifest = json.loads((args.dumps / "stats.json").read_text())
    if not manifest.get("complete"):
        raise RuntimeError("Wikidata snapshot is incomplete")
    imported = {row["key"]: row for path in args.imported for row in read_jsonl(path)}
    rows = list(
        corrections(
            (
                json.loads((args.dumps / name).read_text())["results"]["bindings"]
                for name in manifest["files"]
            ),
            imported,
            OwnerMap(set(json.loads(args.venues.read_text()))),
            set(args.owner),
        )
    )
    write_jsonl(args.out, rows)
    log.info("Owner corrections: %d", len(rows))


if __name__ == "__main__":
    main()
