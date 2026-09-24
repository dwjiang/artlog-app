export function formatConfidence(probability: number | undefined): string | undefined {
  if (probability === undefined || !Number.isFinite(probability) || probability < 0 || probability > 1) {
    return undefined;
  }
  // A ranked candidate is never ruled out, so it floors at 1% instead of reading "0%".
  return `${Math.max(1, Math.round(probability * 100))}% confidence`;
}
