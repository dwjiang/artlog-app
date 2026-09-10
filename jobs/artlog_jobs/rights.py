import re
from collections.abc import Iterable, Sequence
from datetime import UTC, datetime
from typing import Literal

RightsStatus = Literal["public_domain", "in_copyright", "unknown"]


def from_source_flag(flag: object) -> RightsStatus:
    return "public_domain" if flag is True else "unknown"


def from_copyright_notice(notice: str | None) -> RightsStatus:
    if notice and re.search(r"©|\(c\)|all rights reserved", notice, re.IGNORECASE):
        return "in_copyright"
    if not notice or re.search(
        r"public domain|no (known )?copyright|copyright (status |is )?(unknown|undetermined|expired|not)|may be|possibly|permission",
        notice,
        re.IGNORECASE,
    ):
        return "unknown"
    if re.search(r"©|\(c\)|\bcopyright\s+\S+|all rights reserved", notice, re.IGNORECASE):
        return "in_copyright"
    return "unknown"


def from_wikidata(
    statuses: Iterable[str], death_years: Sequence[int | None], *, current_year: int | None = None
) -> RightsStatus:
    year = current_year if current_year is not None else datetime.now(UTC).year
    statuses = set(statuses)
    if "Q50423863" in statuses:
        return "in_copyright"
    # Unrecognized or mixed jurisdiction-specific claims are not a global PD grant.
    if statuses - {"Q19652"}:
        return "unknown"
    if statuses == {"Q19652"}:
        return "public_domain"
    if any(death is not None and death > year for death in death_years):
        return "unknown"
    if any(death is not None and death > year - 70 for death in death_years):
        return "in_copyright"
    if death_years and all(death is not None and death <= year - 100 for death in death_years):
        return "public_domain"
    return "unknown"


def merge_rights(statuses: Iterable[RightsStatus]) -> RightsStatus:
    values = set(statuses)
    if "in_copyright" in values:
        return "in_copyright"
    return "public_domain" if values == {"public_domain"} else "unknown"
