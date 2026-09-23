import { widgetLayout, widgetPresentation } from "./widget-layout";
import { defaultWidgetSettings, widgetCaptions, widgetFrames } from "./widget-settings";
import type { PreparedWidgetArtwork } from "./widget-collection";

const painting: PreparedWidgetArtwork = {
  id: "art",
  title: "The Water Lilies – Morning",
  artist: "Claude Monet",
  museum: "Musée de l’Orangerie",
  visitedOn: "2026-09-08",
  uri: "file:///art.jpg",
  paths: [],
  aspect: 6.4,
};

it("preserves full painting proportions and keeps every element within the widget for each layout", () => {
  for (const aspect of [0.1, 0.37, 0.75, 1, 1.5, 2.25, 6.4, 20])
    for (const caption of widgetCaptions)
      for (const frame of widgetFrames) {
        for (const size of ["small", "medium"] as const) {
          const layout = widgetLayout(
            { ...painting, aspect },
            {
              ...defaultWidgetSettings,
              caption: caption.value,
              frame: frame.value,
              frameWidth: "wide",
            },
            size,
          );
          expect(layout.image!.width / layout.image!.height).toBeCloseTo(aspect);
          for (const element of [...layout.rectangles, ...layout.texts, layout.image!]) {
            expect(element.x).toBeGreaterThanOrEqual(15);
            expect(element.y).toBeGreaterThanOrEqual(15);
            expect(element.x + element.width).toBeLessThanOrEqual(layout.width - 15);
            expect(element.y + element.height).toBeLessThanOrEqual(layout.height - 15);
          }
          if (size === "small") {
            expect(layout.rectangles).toEqual([]);
            expect(layout.texts).toEqual([]);
          }
        }
      }
});

it("wraps long titles, places panoramic captions below the painting, and honors caption choices", () => {
  const full = widgetLayout(painting, defaultWidgetSettings, "medium");
  expect(full.texts[0].y).toBeGreaterThan(full.image!.y + full.image!.height);
  expect(full.texts.map((row) => row.text).join(" ")).toContain("Visited Sep 8, 2026");
  const portrait = widgetLayout(
    { ...painting, title: "Girl with a Pearl Earring", aspect: 0.75 },
    defaultWidgetSettings,
    "medium",
  );
  expect(
    portrait.texts
      .filter((row) => row.family === "Anton")
      .map((row) => row.text)
      .join(" "),
  ).toBe("Girl with a Pearl Earring");
  expect(portrait.texts[0].x).toBeGreaterThan(portrait.image!.x + portrait.image!.width);
  const imageOnly = widgetLayout(painting, { ...defaultWidgetSettings, caption: "none" }, "medium");
  expect(imageOnly.texts).toEqual([]);
  expect(imageOnly.image!.x + imageOnly.image!.width / 2).toBe(167);
  expect(
    widgetLayout(painting, { ...defaultWidgetSettings, caption: "artwork" }, "medium").texts.some(
      (row) => row.text.includes("Visited"),
    ),
  ).toBe(false);
});

it("opens settings when the selected source has no available images", () => {
  const empty = widgetPresentation(undefined, defaultWidgetSettings);
  expect(empty.url).toBe("artlog://widgets");
  expect(empty.small.image).toBeUndefined();
  expect(empty.medium.texts.map((row) => row.text).join(" ")).toContain("Open Artlog");
});
