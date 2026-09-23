import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createWidget } from "expo-widgets";
import { widgetPresentation } from "./widget-layout";
import { defaultWidgetSettings } from "./widget-settings";
import "./artlog-widget";

jest.mock("expo-widgets", () => ({ createWidget: jest.fn(() => ({ reload: jest.fn() })) }));

it("renders the serialized component in the actual isolated widget runtime", () => {
  const layout = jest.mocked(createWidget).mock.calls[0][1] as unknown as string;
  expect(typeof layout).toBe("string");
  const runtime = vm.createContext({});
  const bundle = path.join(
    path.dirname(require.resolve("expo-widgets/package.json")),
    "bundle/build/ExpoWidgets.bundle",
  );
  vm.runInContext(fs.readFileSync(bundle, "utf8"), runtime);
  runtime.__expoWidgetLayout = vm.runInContext(`(${layout})`, runtime);
  const props = widgetPresentation(
    {
      id: "painting",
      title: "Water Lilies",
      artist: "Claude Monet",
      paths: [],
      uri: "file:///painting.jpg",
      aspect: 1,
      museum: "Orangerie",
      visitedOn: "2026-09-08",
      visitId: "paris",
    },
    { ...defaultWidgetSettings, color: "sage" },
  );
  const render = (family: string, width: number) =>
    JSON.stringify(runtime.__expoWidgetRender(props, { widgetFamily: family, width, height: 158 }));
  const small = render("systemSmall", 158),
    medium = render("systemMedium", 334);
  for (const tree of [small, medium]) {
    expect(tree).not.toContain("RedBoxView");
    expect(tree).toContain("file:///painting.jpg");
    expect(tree).toContain("artlog://saved/painting?visitId=paris");
    expect(tree).toContain(props.background);
    expect(JSON.parse(tree).props.modifiers).toContainEqual(
      expect.objectContaining({ $type: "dynamicTypeSize" }),
    );
  }
  expect(small).not.toContain("TextView");
  expect(medium).toContain("TextView");
  expect(medium).toContain("Visited Sep 8, 2026");
});
