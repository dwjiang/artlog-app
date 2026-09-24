export const widgetColors = [
  { value: "paper", name: "Paper", color: "#FCFCF9" },
  { value: "sand", name: "Sand", color: "#F0E5D3" },
  { value: "sage", name: "Sage", color: "#DFE8DD" },
  { value: "sky", name: "Sky", color: "#DFEAF4" },
  { value: "rose", name: "Rose", color: "#F3DFDE" },
  { value: "lilac", name: "Lilac", color: "#E8E2F1" },
] as const;

export const widgetFrames = [
  {
    value: "none",
    name: "No frame",
    color: "transparent",
    light: "transparent",
    dark: "transparent",
  },
  {
    value: "black",
    name: "Black",
    color: "#1C1A18",
    light: "#48443F",
    dark: "#0D0C0B",
  },
  {
    value: "oak",
    name: "Oak",
    color: "#C4A066",
    light: "#DCC08C",
    dark: "#96703F",
  },
  {
    value: "walnut",
    name: "Walnut",
    color: "#45301F",
    light: "#6B4E35",
    dark: "#2A1C13",
  },
  {
    value: "gilt",
    name: "Gilt",
    color: "#B3924B",
    light: "#E3C77A",
    dark: "#8A6A2A",
  },
] as const;

export const widgetCaptions = [
  { value: "none", name: "None", description: "Show only the painting." },
  {
    value: "artwork",
    name: "Title + artist",
    description: "Keep the artwork information.",
  },
  {
    value: "visit",
    name: "Title + artist + visit",
    description: "Include the museum and visit date.",
  },
] as const;

export type WidgetSource = { kind: "collection" } | { kind: "visit"; id: string } | { kind: "artwork"; id: string };
export type WidgetSize = "small" | "medium";
export type WidgetSettings = {
  source: WidgetSource;
  color: (typeof widgetColors)[number]["value"];
  frame: (typeof widgetFrames)[number]["value"];
  frameWidth: "slim" | "wide";
  caption: (typeof widgetCaptions)[number]["value"];
};
export const defaultWidgetSettings: WidgetSettings = {
  source: { kind: "collection" },
  color: "paper",
  frame: "oak",
  frameWidth: "slim",
  caption: "visit",
};
export const widgetSettingsKey = (owner: string) => `widgets:${owner}`;

export function readWidgetSettings(value?: string): WidgetSettings {
  try {
    const parsed = JSON.parse(value ?? "{}");
    const source = parsed.source;
    return {
      source:
        source
        && (source.kind === "visit" || source.kind === "artwork")
        && typeof source.id === "string"
        && source.id.length
          ? { kind: source.kind, id: source.id }
          : defaultWidgetSettings.source,
      color: widgetColors.some((option) => option.value === parsed.color) ? parsed.color : "paper",
      frame: widgetFrames.some((option) => option.value === parsed.frame) ? parsed.frame : "oak",
      caption: widgetCaptions.some((option) => option.value === parsed.caption) ? parsed.caption : "visit",
      frameWidth: parsed.frameWidth === "wide" ? "wide" : "slim",
    };
  } catch {
    return defaultWidgetSettings;
  }
}
