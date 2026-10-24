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
  const view = await render(<DisplayMedia media={catalog} label="Saved title" width={200} />);
  expect(screen.getByRole("progressbar", { name: "Loading image: Saved title" })).toHaveStyle({
    position: "absolute",
  });
  await fireEvent(screen.getByRole("image", { name: "Saved title" }), "load");
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.getByRole("image", { name: "Saved title" })).toHaveStyle({
    width: 200,
    height: 100,
  });
  await view.rerender(
    <DisplayMedia media={{ ...catalog, url: "https://museum.example/new.jpg" }} label="Saved title" width={200} />,
  );
  expect(screen.getByRole("progressbar")).toBeOnTheScreen();
  await fireEvent(screen.getByRole("image", { name: "Saved title" }), "error");
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.getByText("Image unavailable")).toBeOnTheScreen();
});

it("sizes eligible catalog images by dimensions and allows normal caching", async () => {
  await render(<DisplayMedia media={catalog} label="Saved title" width={200} />);
  expect(screen.getByRole("image", { name: "Saved title" })).toHaveStyle({
    width: 200,
    height: 100,
  });
  expect(screen.getByRole("image").props.cachePolicy).toBe("memory-disk");
});

it("serves derivatives through the context route from memory only", async () => {
  await render(<DisplayMedia media={derivative} label="Saved title" width={100} />);
  const image = screen.getByRole("image", { name: "Saved title" });
  expect(image).toHaveStyle({ width: 100, height: 200 });
  expect(image.props.cachePolicy).toBe("memory");
  expect(image.props.source.uri).toBe("https://test.convex.site/display-media?kind=wallItem&itemId=item-a");
});

it("reloads a replaced wall crop even when its dimensions stay the same", async () => {
  const media = {
    kind: "photo" as const,
    width: 300,
    height: 200,
    reference: {
      kind: "wallItem" as const,
      itemId: "item-a" as never,
      photoLocalId: "photo-a",
      variant: "crop" as const,
      cropRevision: 1,
    },
  };
  const view = await render(<DisplayMedia media={media} label="Painting" width={200} />);
  const previousUri = screen.getByRole("image").props.source.uri;
  await fireEvent(screen.getByRole("image"), "load");
  await view.rerender(
    <DisplayMedia
      media={{ ...media, reference: { ...media.reference, cropRevision: 2 } }}
      label="Painting"
      width={200}
    />,
  );
  const image = screen.getByRole("image");
  expect(image.props.source.uri).not.toBe(previousUri);
  expect(new URL(image.props.source.uri).searchParams.get("cropRevision")).toBe("2");
  expect(screen.getByRole("progressbar", { name: "Loading image: Painting" })).toBeOnTheScreen();
});

it("renders accessible square placeholders for absent and broken images and recovers for a new source", async () => {
  const view = await render(
    <DisplayMedia media={{ kind: "placeholder", width: 1, height: 1 }} label="Saved title" width={100} />,
  );
  expect(screen.getByRole("image", { name: "Saved title: image unavailable" })).toHaveStyle({
    width: 100,
    height: 100,
  });
  await view.rerender(<DisplayMedia media={catalog} label="Saved title" width={100} />);
  await fireEvent(screen.getByRole("image"), "error", { error: "Unavailable" });
  expect(screen.getByText("Image unavailable")).toBeOnTheScreen();
  await view.rerender(
    <DisplayMedia media={{ ...catalog, url: "https://museum.example/new.jpg" }} label="Saved title" width={100} />,
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
  const view = await render(<DisplayMedia media={media} label="Saved title" width={100} />);
  expect(screen.getByRole("image").props.source.uri).toContain("kind=sharedVisit&itemId=shared-item&postId=post-a");
  expect(screen.getByRole("image").props.source.headers).toBeUndefined();
  await view.rerender(<DisplayMedia media={media} label="Saved title" width={100} token="token-a" />);
  expect(screen.getByRole("image").props.source.headers).toEqual({
    Authorization: "Bearer token-a",
  });
});

it("keeps shared visit photos on disk but replaceable shared derivatives in memory only", async () => {
  const reference = { kind: "sharedVisit" as const, postId: "post-a", itemId: "shared-item" as never };
  const view = await render(
    <DisplayMedia media={{ ...derivative, reference }} label="Saved title" width={100} token="token-a" />,
  );
  expect(screen.getByRole("image").props.cachePolicy).toBe("memory");
  await view.rerender(
    <DisplayMedia
      media={{ kind: "photo", width: 100, height: 100, reference: { ...reference, photoLocalId: "photo-a" } }}
      label="Saved title"
      width={100}
      token="token-a"
    />,
  );
  expect(screen.getByRole("image").props.cachePolicy).toBe("memory-disk");
});

it("asks for a shared visit photo's feed copy only when both the view and the photo offer it", async () => {
  const media = {
    kind: "photo" as const,
    width: 300,
    height: 400,
    reference: { kind: "sharedVisit" as const, postId: "post-a", itemId: "shared-item" as never, photoLocalId: "a" },
  };
  const size = () => new URL(screen.getByRole("image").props.source.uri).searchParams.get("size");
  const view = await render(
    <DisplayMedia media={{ ...media, feedSize: true }} label="Painting" width={100} feedSize />,
  );
  expect(size()).toBe("feed");
  expect(screen.getByRole("image").props.cachePolicy).toBe("memory-disk");
  await view.rerender(<DisplayMedia media={{ ...media, feedSize: true }} label="Painting" width={100} />);
  expect(size()).toBeNull();
  await view.rerender(<DisplayMedia media={media} label="Painting" width={100} feedSize />);
  expect(size()).toBeNull();
});
