import { ConvexError } from "convex/values";

import { OfflineError, isBackendError, isNetworkError, isTransientError } from "./network-error";

it.each([
  "Unable to upload a file: The Internet connection appears to be offline.",
  "Unable to download a file: Network request timed out",
])("recognizes the native transfer transport failure %s", (message) => {
  const error = new Error(message);
  expect(isNetworkError(error)).toBe(true);
  expect(isTransientError(error)).toBe(true);
});

it.each(["Photo upload failed with HTTP 429", "Unable to download a file: response has status 429"])(
  "retries a rate-limited transfer without classifying it as offline: %s",
  (message) => {
    const error = new Error(message);
    expect(isNetworkError(error)).toBe(false);
    expect(isTransientError(error)).toBe(true);
  },
);

it.each([
  new Error("Photo upload failed with HTTP 404"),
  new Error("Photo upload failed with HTTP 413"),
  new Error("Unable to download a file: response has status 404"),
  new Error("Unable to upload a file: The file could not be opened"),
  new ConvexError({ code: "invalid_photo", message: "Network request failed" }),
  new ConvexError("Photo upload failed with HTTP 429"),
])("keeps item and server validation failures distinct from offline transport", (error) => {
  expect(isNetworkError(error)).toBe(false);
  expect(isTransientError(error)).toBe(false);
});

it.each([
  "fetch failed: The Internet connection appears to be offline.",
  "fetch failed: The request timed out.",
  "fetch failed: The network connection was lost.",
  "fetch failed: Could not connect to the server.",
  "The network connection was lost.",
  "Network request timed out",
])("recognizes an expo/fetch or response body transport failure: %s", (message) => {
  expect(isNetworkError(new Error(message))).toBe(true);
});

it.each([
  "fetch failed: Fetch request has been canceled",
  "fetch failed: The operation was aborted.",
  "fetch failed: Unknown error",
  "fetch failed: Redirect is not allowed when redirect mode is 'error'",
  "Narration download failed.",
])("keeps cancellations and request failures distinct from offline transport: %s", (message) => {
  expect(isNetworkError(new Error(message))).toBe(false);
});

it("treats a skipped offline request as a network failure", () => {
  expect(isNetworkError(new OfflineError())).toBe(true);
});

describe("failures the backend reports itself", () => {
  it.each([
    ["a coded server error", new ConvexError({ code: "narration_provider_failed" })],
    [
      "an unexpected action error",
      new Error("[CONVEX A(narration:render)] [Request ID: 1a2b] Server Error\n  Called by client"),
    ],
    [
      "an unexpected mutation error",
      new Error("[CONVEX M(artworks:research)] [Request ID: 1a2b] Server Error\n  Called by client"),
    ],
  ])("include %s", (_name, error) => {
    expect(isBackendError(error)).toBe(true);
  });

  it.each([
    [
      "a dropped action connection",
      new Error("[CONVEX A(narration:render)] Connection lost while action was in flight\n  Called by client"),
    ],
    ["a download timeout", new Error("fetch failed: The request timed out.")],
    ["a failure on the phone", new Error("Narration transcript is invalid.")],
    ["a request skipped offline", new OfflineError()],
  ])("exclude %s", (_name, error) => {
    expect(isBackendError(error)).toBe(false);
  });
});
