export function formatConfidence(probability: number | undefined): string | undefined {
  if (probability === undefined || !Number.isFinite(probability) || probability < 0 || probability > 1) return undefined;
  return `${Math.round(probability * 100)}% confidence`;
}
