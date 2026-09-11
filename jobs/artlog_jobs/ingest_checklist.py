import argparse
import csv
import json
import re
from datetime import date
from pathlib import Path
from typing import Annotated, Any, Self
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .config import get_settings
from .convex_writer import ConvexWriter

MAX_WORKS = 100
Text = Annotated[str, Field(min_length=1)]


class ChecklistModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Exhibition(ChecklistModel):
    title: Text
    from_date: str = Field(alias="from")
    to: str
    sourceUrl: str

    @model_validator(mode="after")
    def validate_exhibition(self) -> Self:
        for value in (self.from_date, self.to):
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                raise ValueError("exhibition dates must be YYYY-MM-DD")
            date.fromisoformat(value)
        if self.from_date > self.to:
            raise ValueError("exhibition dates are reversed")
        source = urlsplit(self.sourceUrl)
        if source.scheme not in ("https", "http") or not source.netloc:
            raise ValueError("sourceUrl must be an HTTP(S) URL")
        return self


class ObjectWork(ChecklistModel):
    objectKey: Text


class OwnedWork(ChecklistModel):
    ownerKey: Text | None = None
    accession: Text | None = None

    @model_validator(mode="after")
    def require_accession_owner(self) -> Self:
        if self.accession and not self.ownerKey:
            raise ValueError("accession requires ownerKey")
        return self


class WikidataWork(OwnedWork):
    wikidataId: Text


class NamedWork(OwnedWork):
    title: Text
    artist: Text


class Checklist(ChecklistModel):
    venueKey: Text
    exhibition: Exhibition
    gallery: Text | None = None
    works: list[ObjectWork | WikidataWork | NamedWork]


def validate_payload(payload: Any) -> dict[str, Any]:
    return Checklist.model_validate(payload).model_dump(by_alias=True, exclude_none=True)


def load_payload(path: Path, *, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    if path.suffix.lower() == ".json":
        if metadata is not None:
            raise ValueError("JSON contains its own exhibition metadata")
        return validate_payload(json.loads(path.read_text(encoding="utf-8-sig")))
    if path.suffix.lower() != ".csv":
        raise ValueError("checklist must be a .json or .csv file")
    if metadata is None:
        raise ValueError("CSV requires venue and exhibition metadata")
    works = []
    with path.open(encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        if reader.fieldnames != ["title", "artist", "owner", "accession", "wikidata"]:
            raise ValueError("CSV header must be title,artist,owner,accession,wikidata")
        for row in reader:
            if None in row or any(value is None for value in row.values()):
                raise ValueError(f"malformed CSV row {reader.line_num}")
            cells = {key: value.strip() for key, value in row.items() if value.strip()}
            if not cells:
                continue
            work = (
                {"wikidataId": cells["wikidata"]}
                if "wikidata" in cells
                else {key: cells[key] for key in ("title", "artist") if key in cells}
            )
            for column, field in (("owner", "ownerKey"), ("accession", "accession")):
                if column in cells:
                    work[field] = cells[column]
            works.append(work)
    return validate_payload({**metadata, "works": works})


def ingest(writer: ConvexWriter, payload: dict[str, Any]) -> dict[str, Any]:
    # Validate the whole file before committing its first batch; retries are server-idempotent.
    payload = validate_payload(payload)
    placed = 0
    unresolved = []
    for start in range(0, len(payload["works"]), MAX_WORKS):
        result = writer.mutation(
            "checklists:ingestChecklist",
            {
                **payload,
                "works": payload["works"][start : start + MAX_WORKS],
            },
        )
        placed += result["placed"]
        unresolved.extend(result["unresolved"])
    return {"placed": placed, "unresolved": unresolved}


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Ingest a museum-supplied exhibition checklist.")
    parser.add_argument("path", type=Path)
    parser.add_argument(
        "--dry-run", action="store_true", help="Validate and print without connecting to Convex"
    )
    parser.add_argument("--venue-key")
    parser.add_argument("--title")
    parser.add_argument("--from", dest="from_date")
    parser.add_argument("--to")
    parser.add_argument("--source-url")
    parser.add_argument("--gallery")
    args = parser.parse_args(argv)
    metadata = None
    if args.path.suffix.lower() == ".csv":
        if not all((args.venue_key, args.title, args.from_date, args.to, args.source_url)):
            parser.error("CSV requires --venue-key, --title, --from, --to and --source-url")
        metadata = {
            "venueKey": args.venue_key,
            "exhibition": {
                "title": args.title,
                "from": args.from_date,
                "to": args.to,
                "sourceUrl": args.source_url,
            },
            **({"gallery": args.gallery} if args.gallery else {}),
        }
    elif any((args.venue_key, args.title, args.from_date, args.to, args.source_url, args.gallery)):
        parser.error("exhibition flags apply only to CSV; edit metadata in the JSON file")
    try:
        payload = load_payload(args.path, metadata=metadata)
    except (ValueError, OSError) as error:
        parser.error(str(error))
    result = payload if args.dry_run else ingest(ConvexWriter(get_settings()), payload)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
