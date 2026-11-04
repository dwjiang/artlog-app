import { isTransientError } from "./network-error";
import { reportError } from "./observability";

function sourceDetails(uri: string): Record<string, string> {
  try {
    const url = new URL(uri);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return {
        source: "remote",
        source_kind: url.protocol.slice(0, -1),
        requested_host: url.hostname,
      };
    }
    if (url.protocol === "file:" || url.protocol === "ph:" || url.protocol === "assets-library:") {
      return { source: "local", source_kind: url.protocol.slice(0, -1) };
    }
    if (url.protocol === "data:") return { source: "embedded", source_kind: "data" };
  } catch {
    // Invalid sources can contain user content; do not attach the input.
  }
  return { source: "unknown", source_kind: "unknown" };
}

// Match SDWebImage's fixed descriptions exactly; suffixes can contain private URLs or content.
function failureKind(description: string | undefined): string {
  switch (description) {
    case undefined:
    case "":
      return "missing";
    case "Downloaded image decode failed":
      return "decode_failed";
    case "Downloaded image has 0 pixels":
      return "zero_pixels";
    case "Image data is nil":
      return "empty_data";
    case "Download marked as failed because response is nil":
      return "missing_response";
    case "Session delegate is nil and invalid":
    case "Task can't be initialized":
      return "invalid_operation";
    default:
      return "other";
  }
}

export function reportImageLoadError(uri: string, description: string | undefined): void {
  const error = new Error(description || "Image could not load");
  if (isTransientError(error)) return;
  // Expo Image exposes only localizedDescription on iOS, not the response or final redirect URL.
  // Accept the known native status format; arbitrary error text can contain URLs or user content.
  const status =
    /^(?:Download marked as failed because of invalid response status code|Download image failed with code) ([45]\d{2})\.?$/.exec(
      description ?? "",
    )?.[1];
  reportError(new Error(status ? `Image load failed (HTTP ${status})` : "Image load failed"), "media.load", {
    level: "warning",
    data: {
      ...sourceDetails(uri),
      failure_kind: status ? "http" : failureKind(description),
      ...(status ? { status_code: Number(status) } : {}),
    },
  });
}
