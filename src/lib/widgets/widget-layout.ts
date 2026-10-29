import { Fonts, Gallery } from "@/constants/theme";
import { formatVisitDate } from "@/lib/journal/history";

import sfPro from "./metrics/sf-pro.json";
import spaceGrotesk from "./metrics/space-grotesk-semibold.json";
import { widgetArtworkUrl, type PreparedWidgetArtwork } from "./widget-collection";
import { widgetColors, widgetFrames, type WidgetSettings, type WidgetSize } from "./widget-settings";

type Bounds = { x: number; y: number; width: number; height: number };
export type WidgetText = Bounds & {
  text: string;
  size: number;
  family?: string;
  color: string;
};
export type WidgetLayout = {
  width: number;
  height: number;
  rectangles: (Bounds & { color: string })[];
  image?: Bounds & { uri: string };
  texts: WidgetText[];
};
export type WidgetPresentation = {
  small: WidgetLayout;
  medium: WidgetLayout;
  background: string;
  url: string;
  label: string;
};

const metrics: Record<string, Record<string, number>> = {
  [Fonts.display]: spaceGrotesk,
  [Fonts.sans]: sfPro,
};
function measure(value: string, size: number, family: string = Fonts.sans) {
  return Array.from(value).reduce((total, char) => total + (metrics[family][char] ?? metrics[family]["?"]), 0) * size;
}
function wrap(value: string, size: number, family: string | undefined, width: number, limit: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of value.trim().split(/\s+/u)) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate, size, family) <= width) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = "";
    for (const char of word) {
      if (current && measure(current + char, size, family) > width) {
        lines.push(current);
        current = "";
      }
      current += char;
    }
  }
  if (current) lines.push(current);
  if (lines.length > limit) {
    lines.length = limit;
    while (measure(lines[limit - 1] + "…", size, family) > width) {
      lines[limit - 1] = lines[limit - 1].slice(0, -1);
    }
    lines[limit - 1] = lines[limit - 1].trimEnd() + "…";
  }
  return lines;
}

function caption(art: PreparedWidgetArtwork, settings: WidgetSettings, panoramic: boolean) {
  const width = panoramic ? 294 : 157;
  const date = formatVisitDate(art.visitedOn);
  function compose(size: number, limit: number) {
    let height = 0;
    const rows: WidgetText[] = [];
    function append(value: string, size: number, family: string | undefined, gap: number, maxLines: number) {
      const lines = wrap(value, size, family, width, maxLines);
      if (lines.length === 0) return;
      height += gap;
      for (const text of lines) {
        rows.push({
          text,
          x: 0,
          y: height,
          width,
          height: Math.ceil(size * 1.28),
          size,
          family,
          color: family === Fonts.display ? Gallery.ink : Gallery.widgetCaption,
        });
        height += Math.ceil(size * 1.28);
      }
    }
    append(art.title, size, Fonts.display, 0, limit);
    append(art.artist, 11, undefined, 4, 2);
    if (settings.caption === "visit") {
      if (panoramic) {
        append([art.museum, date && `Visited ${date}`].filter(Boolean).join(" · "), 10.5, undefined, 8, 2);
      } else {
        append(art.museum ?? "", 11, undefined, 10, 2);
        append(date && `Visited ${date}`, 11, undefined, 3, 2);
      }
    }
    return { rows, height };
  }
  const maxHeight = panoramic ? 100 : 126;
  for (const [size, limit] of panoramic
    ? [
        [19, 2],
        [17, 2],
      ]
    : [
        [23, 2],
        [21, 3],
        [19, 3],
        [17, 4],
      ]) {
    const value = compose(size, limit);
    const wholeTitle = value.rows
      .filter((row) => row.family === Fonts.display)
      .map((row) => row.text)
      .join(" ");
    if (value.height <= maxHeight && wholeTitle === art.title.trim().replaceAll(/\s+/g, " ")) {
      return value;
    }
  }
  for (let limit = panoramic ? 2 : 3; limit > 0; limit--) {
    const value = compose(17, limit);
    if (value.height <= maxHeight || limit === 1) return value;
  }
  return compose(17, 1);
}

export function paintingLayout(
  art: Pick<PreparedWidgetArtwork, "uri" | "aspect">,
  bounds: Bounds,
  settings: WidgetSettings,
  unframed = false,
): Pick<WidgetLayout, "image" | "rectangles"> {
  const finish = widgetFrames.find((option) => option.value === (unframed ? "none" : settings.frame))!;
  const aspect = Number.isFinite(art.aspect) && art.aspect > 0 ? art.aspect : 1;
  const nominalHeight = Math.min(bounds.height, bounds.width / aspect);
  const thickness =
    finish.value === "none"
      ? 0
      : Math.min(
          settings.frameWidth === "wide" ? 5 : finish.value === "black" ? 1.5 : 2.5,
          Math.min(nominalHeight, nominalHeight * aspect) * 0.12,
        );
  const height = Math.min(bounds.height - thickness * 2, (bounds.width - thickness * 2) / aspect);
  const width = height * aspect;
  const x = bounds.x + (bounds.width - width) / 2;
  const y = bounds.y + (bounds.height - height) / 2;
  return {
    image: { uri: art.uri, x, y, width, height },
    rectangles: thickness
      ? [
          {
            x: x - thickness,
            y: y - thickness,
            width: width + thickness * 2,
            height: height + thickness * 2,
            color: finish.color,
          },
          {
            x: x - thickness,
            y: y - thickness,
            width: width + thickness * 2,
            height: thickness,
            color: finish.light,
          },
          {
            x: x - thickness,
            y: y + height,
            width: width + thickness * 2,
            height: thickness,
            color: finish.dark,
          },
        ]
      : [],
  };
}

export function widgetLayout(art: PreparedWidgetArtwork, settings: WidgetSettings, size: WidgetSize): WidgetLayout {
  if (size === "small") {
    return {
      width: 158,
      height: 158,
      texts: [],
      ...paintingLayout(art, { x: 20, y: 20, width: 118, height: 118 }, settings, true),
    };
  }
  const panoramic = art.aspect > 2.25;
  const hasCaption = settings.caption !== "none";
  const text = hasCaption ? caption(art, settings, panoramic) : { rows: [], height: 0 };
  const artHeight =
    panoramic && hasCaption
      ? Math.max(8, Math.min(settings.caption === "visit" ? 54 : 76, 158 - 44 - text.height))
      : 118;
  const painting = paintingLayout(
    art,
    {
      x: 20,
      y: panoramic && hasCaption ? 18 : 20,
      width: panoramic || !hasCaption ? 294 : 126,
      height: artHeight,
    },
    settings,
  );
  return {
    width: 334,
    height: 158,
    ...painting,
    texts: text.rows.map((row) => ({
      ...row,
      x: panoramic ? 20 : 161,
      y: row.y + (panoramic ? 140 - text.height : (158 - text.height) / 2),
    })),
  };
}

export function widgetPresentation(
  art: PreparedWidgetArtwork | undefined,
  settings: WidgetSettings,
): WidgetPresentation {
  const background = widgetColors.find((option) => option.value === settings.color)!.color;
  if (art) {
    return {
      small: widgetLayout(art, settings, "small"),
      medium: widgetLayout(art, settings, "medium"),
      background,
      url: widgetArtworkUrl(art),
      label: [
        art.title,
        art.artist,
        settings.caption === "visit" && art.museum,
        settings.caption === "visit" && formatVisitDate(art.visitedOn),
      ]
        .filter(Boolean)
        .join(". "),
    };
  }
  const empty = (width: number): WidgetLayout => ({
    width,
    height: 158,
    rectangles: [],
    texts: [
      {
        x: 20,
        y: 40,
        width: width - 40,
        height: 32,
        text: "Your art here",
        size: width < 200 ? 18 : 22,
        family: Fonts.display,
        color: Gallery.ink,
      },
      {
        x: 20,
        y: 83,
        width: width - 40,
        height: 20,
        text: "Open Artlog to choose",
        size: 11,
        family: undefined,
        color: Gallery.widgetCaption,
      },
      {
        x: 20,
        y: 99,
        width: width - 40,
        height: 20,
        text: "saved paintings.",
        size: 11,
        family: undefined,
        color: Gallery.widgetCaption,
      },
    ],
  });
  return {
    small: empty(158),
    medium: empty(334),
    background,
    url: "artlog://widgets",
    label: "Your art here. Open Artlog to choose saved paintings.",
  };
}
