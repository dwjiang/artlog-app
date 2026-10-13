export function normalizeVenueName(name: string): string {
  return name.normalize("NFKC").trim().replaceAll(/\s+/g, " ").toLowerCase();
}
