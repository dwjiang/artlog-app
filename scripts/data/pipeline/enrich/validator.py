import re

# Match ECMAScript whitespace and UTF-16 length, including non-BMP characters.
WHITESPACE = re.compile(
    "[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+"
)


def normalize(text: str) -> str:
    return WHITESPACE.sub(" ", text).strip(" ")


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
        kept.append({"sentence": sentence, "factIds": fact_ids})
    return kept
