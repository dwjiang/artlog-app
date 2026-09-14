import re
import unicodedata
from collections import defaultdict
from collections.abc import Iterable

from .normalize import ArtworkRecord


def normalized(value: str) -> str:
    return " ".join(re.findall(r"\w+", unicodedata.normalize("NFKC", value).casefold()))


def apply_multiplicity(
    artworks: Iterable[ArtworkRecord], *, version_items: set[str], complete: bool
) -> list[ArtworkRecord]:
    artworks = list(artworks)
    groups = defaultdict(set)
    for row in artworks:
        if (
            row.wikidataId
            and "Unknown artist" not in row.artist.split("; ")
            and row.title != row.wikidataId
        ):
            groups[(normalized(row.artist), normalized(row.title))].add(row.wikidataId)
    result = []
    for row in artworks:
        if not row.key.startswith("wikidata:"):
            result.append(row)
            continue
        matches = groups[(normalized(row.artist), normalized(row.title))]
        value = "unknown"
        if len(matches) > 1:
            value = "multiple"
        elif (
            len(matches) == 1
            and complete
            and not row.seriesId
            and row.wikidataId not in version_items
        ):
            value = "unique"
        result.append(row.model_copy(update={"multiplicity": value}))
    return result
