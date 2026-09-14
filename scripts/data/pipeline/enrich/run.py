import argparse
import json
import logging
from collections.abc import Callable
from dataclasses import asdict, dataclass

import httpx
from pydantic import field_validator
from pydantic_settings import SettingsConfigDict

from pipeline.config import Settings, setup_logging
from pipeline.convex_writer import ConvexWriter
from pipeline.polite_http import PoliteClient

from . import docent, factsheet
from .prompts import PROMPT_VERSION
from .providers import Providers, SpendCap
from .sources import SourceGatherer

log = logging.getLogger(__name__)


class EnrichmentSettings(Settings):
    model_config = SettingsConfigDict(hide_input_in_errors=True)

    nebius_api_key: str
    tavily_api_key: str
    fact_sheet_model: str
    docent_model: str

    @field_validator("nebius_api_key", "tavily_api_key", "fact_sheet_model", "docent_model")
    @classmethod
    def nonempty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Required enrichment setting is empty")
        return value.strip()


@dataclass
class RunSummary:
    attempted: int = 0
    written: int = 0
    previewed: int = 0
    failed: int = 0
    superseded: int = 0
    release_failures: int = 0
    generated_sentences: int = 0
    kept_sentences: int = 0
    stopped: str | None = None


def run(
    writer,
    gatherer,
    provider,
    *,
    budget: int,
    batch: int = 20,
    artwork_key: str | None = None,
    dry_run: bool = False,
    emit: Callable[[dict], None] = lambda row: print(json.dumps(row, ensure_ascii=False)),
) -> RunSummary:
    if budget < 1 or not 1 <= batch <= 100:
        raise ValueError("budget must be positive and batch must be within 1..100")
    summary = RunSummary()
    after = None
    seen = set()

    def release(artwork):
        try:
            writer.mutation(
                "enrich:releaseClaim",
                {"artworkId": artwork["_id"], "generation": artwork["enrichGeneration"]},
            )
        except Exception:
            summary.release_failures += 1
            log.exception("Failed to release %s; the claim will expire", artwork["key"])

    while summary.attempted < budget:
        if not artwork_key:
            try:
                provider.check_budget()
            except SpendCap as error:
                summary.stopped = str(error)
                break
        if artwork_key:
            artwork = writer.query("enrich:lookup", {"key": artwork_key})
            if not artwork:
                raise ValueError(f"Artwork not found: {artwork_key}")
            if artwork.get("factSheetNeedsReview"):
                raise ValueError("Fact sheet needs manual review")
            try:
                provider.check_budget(
                    cached=not dry_run and artwork.get("factSheetUpdatedAt") is not None
                )
            except SpendCap as error:
                summary.stopped = str(error)
                break
            if not dry_run:
                generation = writer.mutation("docent:claim", {"artworkId": artwork["_id"]})
                if generation is None:
                    summary.stopped = "Artwork is already enriched or claimed"
                    break
                artwork["enrichGeneration"] = generation
            page = {"artworks": [artwork], "after": None}
        else:
            args = {"limit": min(batch, budget - summary.attempted)}
            if after is not None:
                args["after"] = after
            page = (
                writer.query("enrich:previewBatch", args)
                if dry_run
                else writer.mutation("enrich:claimBatch", args)
            )
        pending = {a["_id"]: a for a in page["artworks"]} if not dry_run else {}
        try:
            for artwork in page["artworks"]:
                if artwork["_id"] in seen:
                    continue
                if summary.attempted >= budget:
                    break
                seen.add(artwork["_id"])
                before = provider.usage.report()
                try:
                    context = writer.query("docent:load", {"artworkId": artwork["_id"]})
                    if (
                        not context
                        or context["artwork"].get("factSheetNeedsReview")
                        or (
                            not dry_run
                            and context["artwork"].get("enrichGeneration")
                            != artwork["enrichGeneration"]
                        )
                    ):
                        summary.superseded += 1
                        continue
                    current = context["artwork"]
                    cached = current.get("factSheetUpdatedAt") is not None
                    # A preview regenerates the complete sheet so an already-enriched work is inspectable.
                    cached = cached and not dry_run
                    provider.check_budget(cached=cached)
                    summary.attempted += 1
                    sources = [] if cached else gatherer.gather(current, context)
                    if not cached and not sources:
                        raise ValueError("No admissible source text; leaving artwork retryable")
                    facts = (
                        current.get("factSheet", [])
                        if cached
                        else factsheet.generate(provider, sources, current)
                    )
                    if not facts:
                        raise ValueError("No grounded facts; leaving artwork retryable")
                    sentences, generated = docent.generate(provider, facts)
                    summary.generated_sentences += generated
                    summary.kept_sentences += len(sentences)
                    result = {
                        "artworkId": artwork["_id"],
                        "key": artwork["key"],
                        "title": artwork["title"],
                        "promptVersion": PROMPT_VERSION,
                        "factSheet": facts,
                        "docentEn": sentences,
                        "sources": sources,
                        "generatedSentences": generated,
                        "dryRun": dry_run,
                    }
                    if not sentences:
                        raise ValueError("All docent sentences dropped; leaving artwork retryable")
                    if dry_run:
                        summary.previewed += 1
                        result["written"] = False
                    else:
                        args = {
                            "artworkId": artwork["_id"],
                            "generation": artwork["enrichGeneration"],
                            "docentEn": sentences,
                        }
                        if not cached:
                            args["factSheet"] = facts
                        written = writer.mutation("docent:writeEnrichment", args)
                        result["written"] = written
                        if written:
                            summary.written += 1
                            pending.pop(artwork["_id"])
                        else:
                            summary.superseded += 1
                    result["usage"] = {
                        k: value - before[k] for k, value in provider.usage.report().items()
                    }
                    emit(result)
                except SpendCap as error:
                    summary.stopped = str(error)
                    break
                except Exception:
                    summary.failed += 1
                    log.exception("%s failed", artwork["key"])
                finally:
                    usage = {k: value - before[k] for k, value in provider.usage.report().items()}
                    log.info("%s usage=%s", artwork["key"], json.dumps(usage))
                    if artwork["_id"] in pending:
                        release(artwork)
                        pending.pop(artwork["_id"])
                if (
                    summary.attempted >= 20
                    and summary.generated_sentences
                    and 1 - summary.kept_sentences / summary.generated_sentences > 0.4
                ):
                    summary.stopped = (
                        "Validator drop rate exceeds 40%; review prompts before spending more"
                    )
                    break
        finally:
            # Also release unstarted claims on cap stops, errors, and Ctrl-C.
            for artwork in pending.values():
                release(artwork)
        after = page["after"]
        if after is None or summary.stopped or artwork_key:
            break
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate grounded artwork enrichment")
    parser.add_argument("--budget", type=int, default=200, help="Maximum artworks attempted")
    parser.add_argument("--batch", type=int, default=20, help="Claim page size (1..100)")
    parser.add_argument("--artwork", help="Artwork key or physical object key, e.g. met:436535")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview without content/claim writes; paid usage is metered",
    )
    args = parser.parse_args()
    settings = EnrichmentSettings()
    setup_logging(settings)
    # Claims and spend reservations are not safe to replay after an ambiguous network failure.
    writer = ConvexWriter(settings, attempts=1)
    with (
        httpx.Client(timeout=60) as http,
        PoliteClient(user_agent=settings.user_agent, max_retries=1, max_retry_after=10) as polite,
    ):
        provider = Providers(writer, http, settings)
        gatherer = SourceGatherer(polite, provider.search)
        summary = run(
            writer,
            gatherer,
            provider,
            budget=args.budget,
            batch=args.batch,
            artwork_key=args.artwork,
            dry_run=args.dry_run,
        )
        log.info(
            "summary=%s",
            json.dumps(
                {
                    **asdict(summary),
                    "usage": provider.usage.report(),
                    "schemaFallbacks": provider.schema_fallbacks,
                    "parseFailures": provider.parse_failures,
                    "modelResponses": provider.model_responses,
                }
            ),
        )
    return 2 if summary.stopped or summary.failed or summary.release_failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
