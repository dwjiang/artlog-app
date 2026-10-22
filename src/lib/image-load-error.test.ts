import * as Sentry from "@sentry/react-native";

import { reportImageLoadError } from "./image-load-error";

let clock = Date.now();

beforeEach(() => {
  jest.clearAllMocks();
  clock += 60_001;
  jest.spyOn(Date, "now").mockReturnValue(clock);
});

afterEach(() => jest.restoreAllMocks());

it("reports the requested host and native HTTP status without private URL or error content", () => {
  reportImageLoadError(
    "https://alice:password@images.example.org/private/photo.jpg?signature=secret#token",
    "Download marked as failed because of invalid response status code 403",
  );
  const [error, options] = jest.mocked(Sentry.captureException).mock.calls[0];
  expect((error as Error).message).toBe("Image load failed (HTTP 403)");
  expect(options).toMatchObject({
    level: "warning",
    tags: { operation: "media.load" },
    contexts: {
      operation: { source: "remote", source_kind: "https", requested_host: "images.example.org", status_code: 403 },
    },
  });
  expect(JSON.stringify(options)).not.toMatch(/alice|password|private|photo.jpg|signature|secret|token/);
});

it.each([
  ["file:///private/photo.jpg", "local", "file"],
  ["ph://private-photo-id", "local", "ph"],
  ["assets-library://asset/private-id", "local", "assets-library"],
  ["data:image/png;base64,private-bytes", "embedded", "data"],
  ["not a URL with private content", "unknown", "unknown"],
])("does not report a host or content for %s", (uri, source, sourceKind) => {
  reportImageLoadError(uri, "private response body /Users/alice/photo.jpg secret=secret");
  const [error, options] = jest.mocked(Sentry.captureException).mock.calls[0];
  expect((error as Error).message).toBe("Image load failed");
  expect(options).toMatchObject({ contexts: { operation: { source, source_kind: sourceKind } } });
  expect(options).not.toHaveProperty("contexts.operation.requested_host");
  expect(JSON.stringify(options)).not.toMatch(/private|alice|secret/);
});

it("does not guess a status from a URL or unrelated number", () => {
  reportImageLoadError("https://images.example.org/403", "Failed https://images.example.org/403?token=secret");
  const [error, options] = jest.mocked(Sentry.captureException).mock.calls[0];
  expect((error as Error).message).toBe("Image load failed");
  expect(options).not.toHaveProperty("contexts.operation.status_code");
});

it("keeps expected offline failures out of Sentry", () => {
  reportImageLoadError("https://images.example.org/photo.jpg", "The Internet connection appears to be offline.");
  expect(Sentry.captureException).not.toHaveBeenCalled();
});

it.each(["Download image failed with code 503", "Download image failed with code 503."])(
  "records explicit server status from %s",
  (description) => {
    reportImageLoadError("https://images.example.org/artwork", description);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Image load failed (HTTP 503)" }),
      expect.objectContaining({
        contexts: {
          operation: { source: "remote", source_kind: "https", requested_host: "images.example.org", status_code: 503 },
        },
      }),
    );
  },
);

it("handles an absent native description", () => {
  reportImageLoadError("https://images.example.org/artwork", undefined);
  expect(Sentry.captureException).toHaveBeenCalledWith(
    expect.objectContaining({ message: "Image load failed" }),
    expect.anything(),
  );
});
