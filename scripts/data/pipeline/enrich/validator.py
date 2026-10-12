import re
import unicodedata

# Match ECMAScript whitespace and UTF-16 length, including non-BMP characters.
WHITESPACE = re.compile(
    "[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+"
)


def normalize(text: str) -> str:
    return WHITESPACE.sub(" ", text).strip(" ")


QUOTE_MARKS = re.compile(
    "[\"'\u2018\u2019\u201a\u201b\u201c\u201d\u201e\u201f\u00ab\u00bb\u2039\u203a\u00b4`\u02bc]"
)
# NFKD strips accents; these letters have no separate accent to strip.
FOLDED = str.maketrans(
    {
        "ø": "o",
        "æ": "ae",
        "œ": "oe",
        "ß": "ss",
        "ł": "l",
        "đ": "d",
        "ð": "d",
        "þ": "th",
        "ı": "i",
        "×": "x",
    }
)
DASHES = re.compile("[\u2010-\u2015-]+")


# Typography varies between a page and its copy: quote marks, accents, dash and hyphen styles, case
# and spacing. The words must not (shared/audio/guide.ts normalizePassage). Quote marks go first:
# NFKD would split an acute accent typed as an apostrophe ("Monet´s") into a space.
def source_passage(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", QUOTE_MARKS.sub("", text))
    plain = "".join(
        c for c in decomposed if c != "\u00ad" and not unicodedata.category(c).startswith("M")
    )
    return normalize(DASHES.sub(" ", plain.lower().translate(FOLDED)))


def validate(sentences: list[dict], fact_ids_on_sheet: set[str]) -> list[dict]:
    kept = []
    seen = set()
    for candidate in sentences:
        if len(kept) == 4:
            break
        sentence = normalize(candidate["sentence"])
        fact_ids = list(dict.fromkeys(candidate["factIds"]))
        if not fact_ids or any(fid not in fact_ids_on_sheet for fid in fact_ids):
            continue
        if (
            not sentence
            or len(sentence.encode("utf-16-le", errors="surrogatepass")) // 2 > 240
            or len(sentence.split(" ")) < 4
            or sentence in seen
        ):
            continue
        seen.add(sentence)
        # A sentence copied from a caption has no full stop, and the paragraph would run on without one.
        if not re.search(r"[.!?…][\"'”’)]*$", sentence):
            sentence += "."
        kept.append({"sentence": sentence, "factIds": fact_ids})
    return kept
