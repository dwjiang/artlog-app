import { fireEvent, render, screen } from "@testing-library/react-native";
import { DisplayMedia } from "./display-media";

jest.mock("expo-image", () => {
  const { View } = jest.requireActual("react-native");
  return {
    Image: (props: object) => <View accessibilityRole="image" {...props} />,
  };
});
const catalog = {
  kind: "catalog" as const,
  url: "https://museum.example/image.jpg",
  sourceUrl: "https://museum.example/art",
  rights: "public_domain" as const,
  width: 400,
  height: 200,
};
const derivative = {
  kind: "derivative" as const,
  rights: "contributor_consent" as const,
  width: 128,
  height: 256,
  reference: { kind: "wallItem" as const, itemId: "item-a" as never },
};
beforeEach(() => {
  process.env.EXPO_PUBLIC_CONVEX_SITE_URL = "https://test.convex.site";
});

it("reveals the image when loaded and removes the ghost after failure", async () => {
  const view = await render(
    <DisplayMedia media={catalog} label="Saved title" width={200} />,
  );
  expect(
    screen.getByRole("progressbar", { name: "Loading image: Saved title" }),
  ).toHaveStyle({
    position: "absolute",
  });
  await fireEvent(screen.getByRole("image", { name: "Saved title" }), "load");
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.getByRole("image", { name: "Saved title" })).toHaveStyle({
    width: 200,
    height: 100,
  });
  await view.rerender(
    <DisplayMedia
      media={{ ...catalog, url: "https://museum.example/new.jpg" }}
      label="Saved title"
      width={200}
    />,
  );
  expect(screen.getByRole("progressbar")).toBeOnTheScreen();
  await fireEvent(screen.getByRole("image", { name: "Saved title" }), "error");
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.getByText("Image unavailable")).toBeOnTheScreen();
});

it("sizes eligible catalog images by dimensions and allows normal caching", async () => {
  await render(
    <DisplayMedia media={catalog} label="Saved title" width={200} />,
  );
  expect(screen.getByRole("image", { name: "Saved title" })).toHaveStyle({
    width: 200,
    height: 100,
  });
  expect(screen.getByRole("image").props.cachePolicy).toBe("memory-disk");
});
it("serves derivatives through the context route with caching disabled", async () => {
  await render(
    <DisplayMedia media={derivative} label="Saved title" width={100} />,
  );
  const image = screen.getByRole("image", { name: "Saved title" });
  expect(image).toHaveStyle({ width: 100, height: 200 });
  expect(image.props.cachePolicy).toBe("none");
  expect(image.props.source.uri).toBe(
    "https://test.convex.site/display-media?kind=wallItem&itemId=item-a",
  );
});
it("renders accessible square placeholders for absent and broken images and recovers for a new source", async () => {
  const view = await render(
    <DisplayMedia
      media={{ kind: "placeholder", width: 1, height: 1 }}
      label="Saved title"
      width={100}
    />,
  );
  expect(
    screen.getByRole("image", { name: "Saved title: image unavailable" }),
  ).toHaveStyle({
    width: 100,
    height: 100,
  });
  await view.rerender(
    <DisplayMedia media={catalog} label="Saved title" width={100} />,
  );
  await fireEvent(screen.getByRole("image"), "error", { error: "Unavailable" });
  expect(screen.getByText("Image unavailable")).toBeOnTheScreen();
  await view.rerender(
    <DisplayMedia
      media={{ ...catalog, url: "https://museum.example/new.jpg" }}
      label="Saved title"
      width={100}
    />,
  );
  expect(screen.getByRole("image", { name: "Saved title" })).toBeOnTheScreen();
});
it("serves shared visits with optional credentials and requires them only for previews", async () => {
  const media = {
    ...derivative,
    reference: {
      kind: "sharedVisit" as const,
      postId: "post-a",
      itemId: "shared-item" as never,
    },
  };
  const view = await render(
    <DisplayMedia media={media} label="Saved title" width={100} />,
  );
  expect(screen.getByRole("image").props.source.uri).toContain(
    "kind=sharedVisit&itemId=shared-item&postId=post-a",
  );
  expect(screen.getByRole("image").props.source.headers).toBeUndefined();
  await view.rerender(
    <DisplayMedia
      media={media}
      label="Saved title"
      width={100}
      token="token-a"
    />,
  );
  expect(screen.getByRole("image").props.source.headers).toEqual({
    Authorization: "Bearer token-a",
  });
  const preview = {
    ...derivative,
    reference: {
      kind: "sharedVisitPreview" as const,
      visitLocalId: "visit-a",
      saveLocalId: "save-a",
    },
  };
  await view.rerender(
    <DisplayMedia media={preview} label="Saved title" width={100} />,
  );
  expect(screen.getByText("Image unavailable")).toBeOnTheScreen();
  await view.rerender(
    <DisplayMedia
      media={preview}
      label="Saved title"
      width={100}
      token="token-a"
    />,
  );
  expect(screen.getByRole("image").props.source.uri).toContain(
    "kind=sharedVisitPreview&visitLocalId=visit-a&saveLocalId=save-a",
  );
  expect(screen.getByRole("image").props.source.headers).toEqual({
    Authorization: "Bearer token-a",
  });
  await view.rerender(
    <DisplayMedia
      media={preview}
      label="Saved title"
      width={100}
      token={null}
    />,
  );
  expect(screen.getByText("Image unavailable")).toBeOnTheScreen();
});
