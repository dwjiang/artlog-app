import { formatConfidence } from "./confidence";

it.each([
  [0, "0% confidence"],
  [0.31, "31% confidence"],
  [0.626, "63% confidence"],
  [1, "100% confidence"],
])("formats candidate probability %s as %s", (probability, label) => {
  expect(formatConfidence(probability)).toBe(label);
});

it.each([undefined, NaN, Infinity, -0.1, 1.1])("omits unavailable or invalid confidence %s", (probability) => {
  expect(formatConfidence(probability)).toBeUndefined();
});
