export function createQrDebouncer(): (value: string, now: number) => boolean {
  const seen = new Map<string, number>();
  return (value, now) => {
    try {
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol) || !url.hostname) return false;
    } catch {
      return false;
    }
    for (const [code, timestamp] of seen) {
      if (now - timestamp >= 3000) seen.delete(code);
    }
    if (seen.has(value)) return false;
    seen.set(value, now);
    return true;
  };
}
