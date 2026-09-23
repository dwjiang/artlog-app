type Dictionary = Record<string, unknown>;

function dictionary(value: unknown): Dictionary {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Dictionary)
    : {};
}

function coordinate(value: unknown, reference: unknown, limit: number): number | undefined {
  let degrees: number;
  if (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((part) => typeof part === "number" && Number.isFinite(part))
  ) {
    const [d, m, s] = value as [number, number, number];
    if (m < 0 || m >= 60 || s < 0 || s >= 60) return;
    degrees = (Math.abs(d) + m / 60 + s / 3600) * (d < 0 ? -1 : 1);
  } else if (typeof value === "number") {
    degrees = value;
  } else {
    return;
  }
  if (!Number.isFinite(degrees) || Math.abs(degrees) > limit) return;
  if (reference === "S" || reference === "W") return -Math.abs(degrees);
  if (reference === "N" || reference === "E") return Math.abs(degrees);
  return degrees;
}

function captureTime(value: unknown, offset: unknown): number | undefined {
  if (typeof value !== "string") return;
  const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  // Validate calendar fields without the phone's daylight-saving transitions.
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  )
    return;
  const withOffset =
    typeof offset === "string" && /^[+-]\d{2}:\d{2}$/.test(offset)
      ? Date.parse(`${value.slice(0, 10).replaceAll(":", "-")}T${value.slice(11)}${offset}`)
      : NaN;
  // EXIF without an offset is a local wall-clock time, not UTC.
  const timestamp = Number.isFinite(withOffset)
    ? withOffset
    : new Date(year, month - 1, day, hour, minute, second).getTime();
  // Pre-1970 dates come from reset camera clocks or scans; the journal only accepts non-negative timestamps.
  return timestamp >= 0 ? timestamp : undefined;
}

export function extractCaptureMeta(exif: Dictionary | null | undefined): {
  lat?: number;
  lng?: number;
  capturedAt: number;
} {
  const flat = exif ?? {};
  const gps = dictionary(flat["{GPS}"]);
  const photo = dictionary(flat["{Exif}"]);
  const lat = coordinate(
    flat.GPSLatitude ?? gps.Latitude,
    flat.GPSLatitudeRef ?? gps.LatitudeRef,
    90,
  );
  const lng = coordinate(
    flat.GPSLongitude ?? gps.Longitude,
    flat.GPSLongitudeRef ?? gps.LongitudeRef,
    180,
  );
  return {
    ...(lat === undefined ? {} : { lat }),
    ...(lng === undefined ? {} : { lng }),
    capturedAt:
      captureTime(
        flat.DateTimeOriginal ?? photo.DateTimeOriginal,
        flat.OffsetTimeOriginal ?? photo.OffsetTimeOriginal,
      ) ?? Date.now(),
  };
}
