import {
  createWidgetPublisher,
  currentWidgetIndex,
  widgetRotationSeconds,
} from "./widget-publisher";
import { defaultWidgetSettings } from "./widget-settings";
import type { PreparedWidgetArtwork, WidgetArtwork } from "./widget-collection";

const art: WidgetArtwork = {
  id: "art",
  title: "Water Lilies",
  artist: "Monet",
  paths: ["photo.jpg"],
};
const ready: PreparedWidgetArtwork = {
  ...art,
  uri: "file:///shared/photo.jpg",
  aspect: 1,
};
const deferred = () => {
  let resolve!: (value: PreparedWidgetArtwork) => void;
  const promise = new Promise<PreparedWidgetArtwork>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

it("publishes only the latest source when image preparation overlaps", async () => {
  const first = deferred(),
    write = jest.fn(),
    prune = jest.fn();
  const publisher = createWidgetPublisher({
    currentOwner: () => "one",
    prepare: jest
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue({ ...ready, id: "new" }),
    write,
    prune,
  });
  const outdated = publisher.publish("one", [art], defaultWidgetSettings);
  await publisher.publish(
    "one",
    [{ ...art, id: "new" }],
    defaultWidgetSettings,
  );
  first.resolve(ready);
  expect(await outdated).toBeUndefined();
  expect(write).toHaveBeenCalledTimes(1);
  expect(write.mock.calls[0][0][0].url).toBe("artlog://saved/new");
  expect(prune).toHaveBeenCalledTimes(1);
});

it("never restores another account’s images after an owner change", async () => {
  const loading = deferred(),
    write = jest.fn();
  let owner = "one";
  const publisher = createWidgetPublisher({
    currentOwner: () => owner,
    prepare: () => loading.promise,
    write,
    prune: jest.fn(),
  });
  const pending = publisher.publish("one", [art], defaultWidgetSettings);
  owner = "two";
  loading.resolve(ready);
  await pending;
  expect(write).not.toHaveBeenCalled();
});

it("replaces deleted or unavailable art with a settings link and clears old images", async () => {
  const write = jest.fn(),
    prune = jest.fn();
  const publisher = createWidgetPublisher({
    currentOwner: () => "one",
    prepare: async () => undefined,
    write,
    prune,
  });
  expect(await publisher.publish("one", [art], defaultWidgetSettings)).toEqual(
    [],
  );
  expect(write.mock.calls[0][0][0].url).toBe("artlog://widgets");
  expect(prune).toHaveBeenCalledWith([]);
});

it("cycles all artworks and keeps a single selected painting fixed", () => {
  const interval = widgetRotationSeconds * 1000;
  expect(
    [0, 1, 2, 3, 4, 5].map((time) => currentWidgetIndex(3, time * interval)),
  ).toEqual([0, 1, 2, 0, 1, 2]);
  expect(currentWidgetIndex(1, 500 * interval)).toBe(0);
});
