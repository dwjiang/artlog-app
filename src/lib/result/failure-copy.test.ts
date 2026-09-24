import { failureCopy } from "./failure-copy";

it.each([
  ["bad_features", "The photo couldn’t be read. Try scanning the painting again."],
  ["bad_vector", "The photo couldn’t be read. Try scanning the painting again."],
  ["rate_limited", "Too many scans right now. Try again in a minute."],
  ["unauthenticated", "This phone isn’t set up to identify yet. Try again in a moment."],
  ["device_not_registered", "This phone isn’t set up to identify yet. Try again in a moment."],
  ["device_banned", "This phone can’t identify paintings."],
  ["invalid_visit", "The museum for this scan couldn’t be confirmed."],
  ["not_found", "The museum for this scan couldn’t be confirmed."],
  ["scan_not_found", "The server no longer has this scan."],
  ["Identification interrupted", "Identification was interrupted before the server answered."],
  ["Network request failed", "The connection dropped before the server answered."],
  [
    "[CONVEX A(identify:identify)] Connection lost while action was in flight",
    "The connection dropped before the server answered.",
  ],
  ["some_new_code", "Something went wrong while identifying this painting."],
  ["The capture visit is missing its venue", "Something went wrong while identifying this painting."],
  [
    "[CONVEX Q(scans:get)] [Request ID: sensitive-id] ArgumentValidationError: Value does not match validator.\nCalled by client",
    "This scan link is invalid or no longer available.",
  ],
  ["[CONVEX Q(scans:get)] Server Error\nCalled by client", "Something went wrong while identifying this painting."],
])('turns "%s" into friendly copy', (error, expected) => {
  expect(failureCopy(error)).toBe(expected);
});

it.each([undefined, null, ""])("has a generic line when the error is %s", (error) => {
  expect(failureCopy(error)).toBe("Something went wrong while identifying this painting.");
});
