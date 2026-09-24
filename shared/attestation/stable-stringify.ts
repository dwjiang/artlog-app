export function stableStringify(payload: object): string {
  const json = JSON.stringify(payload, (_key, value: unknown) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }
    return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  });
  if (json === undefined) {
    throw new TypeError("Payload must be JSON serializable");
  }
  return json;
}
