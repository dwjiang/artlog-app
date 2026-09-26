export function parseIosBuild(value: string): number[] | null {
  if (!/^\d+(?:\.\d+){0,2}$/.test(value)) return null;
  const parts = value.split(".").map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

export function isIosBuildSupported(build: string | null, minimum: string | null): boolean {
  if (minimum === null || build === null) return true;
  const installed = parseIosBuild(build);
  const required = parseIosBuild(minimum);
  if (!installed || !required) return true;
  for (let index = 0; index < 3; index++) {
    const difference = (installed[index] ?? 0) - (required[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}
