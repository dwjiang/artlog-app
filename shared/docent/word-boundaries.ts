// Han and kana have no required spaces; their character boundaries must not split Latin words or numbers.
export function separateUnspacedCharacters(text: string): string {
  return text
    .replaceAll(
      /([\u3000-\u30ff\u31f0-\u31ff\u3400-\u9fff\uf900-\ufaff\u{1aff0}-\u{1b16f}\u{20000}-\u{3347f}])/gu,
      " $1 ",
    )
    .replaceAll(/\s+/g, " ")
    .trim();
}
