import { arrangeShareGrid, sharedOrder } from "./share-order";

describe("arrangeShareGrid", () => {
  it("follows the visit order until the person arranges the grid", () => {
    expect(arrangeShareGrid([], ["a", "b", "c"], ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("keeps a left-out artwork in its place and fills the other places in shared order", () => {
    expect(arrangeShareGrid(["a", "b", "c", "d"], ["d", "a", "c"], ["a", "b", "c", "d"])).toEqual(["d", "b", "a", "c"]);
  });

  it("drops artworks that left the visit and appends ones that joined it", () => {
    expect(arrangeShareGrid(["x", "a", "b"], ["b", "a"], ["a", "b", "c"])).toEqual(["b", "a", "c"]);
  });
});

describe("sharedOrder", () => {
  it("shares the included artworks in grid order", () => {
    expect(sharedOrder(["d", "b", "a", "c"], new Set(["a", "d"]))).toEqual(["d", "a"]);
  });
});
