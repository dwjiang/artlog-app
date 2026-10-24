import { horizontalSafeAreaPadding } from "./safe-area";

const RAIL_RIGHT = { left: 0, right: 84 };

it("pads each side by its inset when the style sets no padding", () => {
  expect(horizontalSafeAreaPadding(undefined, RAIL_RIGHT)).toEqual({ paddingLeft: 0, paddingRight: 84 });
});

it("adds the inset to the padding the style resolves to on each side", () => {
  expect(horizontalSafeAreaPadding({ padding: 10 }, RAIL_RIGHT)).toEqual({ paddingLeft: 10, paddingRight: 94 });
  expect(
    horizontalSafeAreaPadding([{ padding: 10 }, { paddingHorizontal: 20 }, { paddingLeft: 4 }], RAIL_RIGHT),
  ).toEqual({ paddingLeft: 4, paddingRight: 104 });
});

it("treats padding that is not in points as none", () => {
  expect(horizontalSafeAreaPadding({ paddingHorizontal: "5%" }, { left: 62, right: 62 })).toEqual({
    paddingLeft: 62,
    paddingRight: 62,
  });
});
