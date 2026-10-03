import { act, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { WallFrame } from "./wall-frame";

type Texture = { id: string };
const mockPending = new Map<string, (image: Texture) => void>();

jest.mock("@shopify/react-native-skia/lib/commonjs/skia/Skia", () => ({
  Skia: {
    Data: { fromURI: (uri: string) => new Promise<Texture>((resolve) => mockPending.set(uri, resolve)) },
    Image: { MakeImageFromEncoded: (image: Texture) => image },
  },
}));
jest.mock("@shopify/react-native-skia/lib/commonjs/Platform", () => ({
  Platform: { resolveAsset: String },
}));
jest.mock("@shopify/react-native-skia", () => {
  const { View, Text } = jest.requireActual("react-native");
  return {
    Canvas: View,
    Picture: ({ picture }: { picture: string }) => <Text>{picture}</Text>,
    // Keep the installed loading hook real; only native decoding and drawing are replaced.
    useImage: jest.requireActual("@shopify/react-native-skia/lib/commonjs/skia/core/Image").useImage,
    FilterMode: { Linear: 1 },
    MipmapMode: { None: 0 },
    createPicture: (
      draw: (canvas: { translate: () => void; drawImageRectOptions: (image: Texture) => void }) => void,
    ) => {
      let texture = "";
      draw({
        translate: () => {},
        drawImageRectOptions: (image) => {
          texture = image.id;
        },
      });
      return texture;
    },
  };
});
jest.mock("@/lib/wall/wall-frame-assets", () => ({
  wallFrameAssets: {
    oak: { source: 1, bounds: { width: 512, height: 512, left: 80, right: 80, top: 80, bottom: 80 } },
    walnut: { source: 2, bounds: { width: 512, height: 512, left: 80, right: 80, top: 80, bottom: 80 } },
  },
}));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));

function artwork(frame: "oak" | "walnut") {
  return (
    <WallFrame frame={frame} width={166} height={200}>
      <Text>Artwork</Text>
    </WallFrame>
  );
}

beforeEach(() => mockPending.clear());

it("keeps the selected texture when an older frame load finishes later", async () => {
  const view = await render(artwork("oak"));
  await view.rerender(artwork("walnut"));
  await act(async () => mockPending.get("2")!({ id: "Walnut texture" }));
  expect(screen.getByText("Walnut texture")).toBeOnTheScreen();

  await act(async () => mockPending.get("1")!({ id: "Oak texture" }));
  expect(screen.getByText("Walnut texture")).toBeOnTheScreen();
  expect(screen.queryByText("Oak texture")).toBeNull();
});

it("removes the previous texture while the selected frame loads without hiding the artwork", async () => {
  const view = await render(artwork("oak"));
  await act(async () => mockPending.get("1")!({ id: "Oak texture" }));
  expect(screen.getByText("Oak texture")).toBeOnTheScreen();

  await view.rerender(artwork("walnut"));
  expect(screen.queryByText("Oak texture")).toBeNull();
  expect(screen.getByText("Artwork")).toBeOnTheScreen();

  await act(async () => mockPending.get("2")!({ id: "Walnut texture" }));
  expect(screen.getByText("Walnut texture")).toBeOnTheScreen();
});
