import { expect, it } from "vitest";

import { bestCropIndex, isNormalizedQuad, NESTED_CROP_MIN_GAIN, NESTED_CROP_MIN_SIMILARITY } from "./cropChoice";

const strong = NESTED_CROP_MIN_SIMILARITY + 0.2;

it("keeps the outer crop when no nested crop matches better", () => {
  expect(bestCropIndex([strong, strong - 0.1, strong - 0.2])).toBe(0);
  expect(bestCropIndex([strong])).toBe(0);
});

it("switches to the nested crop that clearly matches an artwork best", () => {
  const outer = strong - NESTED_CROP_MIN_GAIN - 0.1;
  expect(bestCropIndex([outer, strong - 0.05, strong])).toBe(2);
});

it("keeps the outer crop when the best nested match is too weak to trust", () => {
  const weak = NESTED_CROP_MIN_SIMILARITY - 0.01;
  expect(bestCropIndex([weak - NESTED_CROP_MIN_GAIN - 0.1, weak])).toBe(0);
});

it("keeps the outer crop when the nested crop is barely closer", () => {
  expect(bestCropIndex([strong, strong + NESTED_CROP_MIN_GAIN / 2])).toBe(0);
});

it("accepts only four corners inside the photo", () => {
  const whole = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  expect(isNormalizedQuad(whole)).toBe(true);
  expect(isNormalizedQuad(whole.slice(0, 3))).toBe(false);
  expect(isNormalizedQuad([...whole.slice(0, 3), [0, 1.2]])).toBe(false);
  expect(isNormalizedQuad([...whole.slice(0, 3), [0, Number.NaN]])).toBe(false);
  expect(isNormalizedQuad([...whole.slice(0, 3), [0]])).toBe(false);
});
