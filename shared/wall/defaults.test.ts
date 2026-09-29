import { randomWallStyle, STARTER_WALLS, WALL_COLORS } from "./defaults";

it("can choose each starter style and always supplies an editable color and design", () => {
  const random = jest.spyOn(Math, "random");
  try {
    for (const [index, preset] of STARTER_WALLS.entries()) {
      random.mockReturnValue((index + 0.5) / STARTER_WALLS.length);
      const style = randomWallStyle();
      expect(style).toEqual(preset);
      expect(style).not.toBe(preset);
      expect(WALL_COLORS.some((color) => color.value === style.color)).toBe(true);
      expect(style.pattern).toBeTruthy();
    }
  } finally {
    random.mockRestore();
  }
});
