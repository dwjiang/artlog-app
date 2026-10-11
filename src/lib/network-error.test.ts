import { ConvexError } from "convex/values";

import { isNetworkError, isTransientError } from "./network-error";

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
