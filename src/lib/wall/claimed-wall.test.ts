import { insertSavedWork } from "@/db/repos/saved-works";
import { getSetting, setSetting } from "@/db/repos/settings";
import { flushCollectionMedia } from "@/lib/account/collection-sync";
import { captureOwner, subscribeOwner, switchOwner } from "@/lib/account/owner-store";
import { reportError } from "@/lib/observability";

import { publishClaimedWall } from "./claimed-wall";
import { createLocalWallRepository } from "./local-wall-repository";
import { createWallRepository } from "./wall-repository";
import type { OwnerWall, WallTransport } from "./wall-transport";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));
jest.mock("@/lib/account/collection-sync", () => ({ flushCollectionMedia: jest.fn(async () => {}) }));

const layout = { x: 0, y: 0, width: 0.5, layer: 0, frame: "black" as const };
const emptyWall: OwnerWall = {
  scope: "scope-a",
  profileId: "profile-a" as never,
  revision: 1,
  color: "#CDD0CA",
  items: [],
};
const hungWall: OwnerWall = {
  ...emptyWall,
  items: [
    {
      itemId: "item-a" as never,
      placementId: "account-placement",
      saveLocalId: "account-save",
      noteVisible: false,
      noteRevision: 0,
      noteEligible: false,
      layout,
      artwork: {
        title: "The Milkmaid",
        artist: "Johannes Vermeer",
        media: { kind: "placeholder", width: 1, height: 1 },
      },
    },
  ],
};
const guestWall = {
  color: "#6C2F2B",
  items: [
    { placementId: "kept-placement", saveLocalId: "kept", layout },
    { placementId: "deleted-placement", saveLocalId: "deleted", layout },
    { placementId: "deleted-photo-placement", saveLocalId: "kept", photoLocalId: "deleted-photo", layout },
  ],
};

function holdSync() {
  let started!: () => void;
  let finish!: () => void;
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  jest.mocked(flushCollectionMedia).mockImplementationOnce(() => {
    started();
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  return { running, finish: () => finish() };
}

let counter = 0;
async function signIn(serverWall: OwnerWall) {
  const owner = `account:claimed-${++counter}`;
  switchOwner(owner, "scope-a");
  await insertSavedWork({ localId: "kept", savedAt: 1, title: "Water Lilies", artist: "Claude Monet" }, owner);
  await setSetting(`wall:${owner}`, JSON.stringify(guestWall));
  const transport = {
    getMine: jest.fn().mockResolvedValue(serverWall),
    setLayout: jest.fn().mockResolvedValue({ ...serverWall, revision: 2, color: guestWall.color }),
    setNoteVisibility: jest.fn(),
  } satisfies WallTransport;
  const repository = createWallRepository({
    transport,
    capture: () => ({ ...captureOwner(), token: "token" }),
    subscribeOwner,
    online: async () => true,
  });
  repository.connect();
  await repository.refresh();
  return { owner, transport, repository };
}

beforeEach(() => {
  jest.clearAllMocks();
});

it("publishes the wall a guest arranged when the account's wall is empty, without art or photos since removed", async () => {
  const { owner, transport, repository } = await signIn(emptyWall);
  await publishClaimedWall(repository);
  expect(transport.setLayout).toHaveBeenCalledWith(
    {
      scope: "scope-a",
      revision: 1,
      color: "#6C2F2B",
      items: [{ placementId: "kept-placement", saveLocalId: "kept", layout }],
    },
    expect.anything(),
  );
  expect(await getSetting(`wall:${owner}`)).toBeUndefined();
  expect(reportError).not.toHaveBeenCalled();
});

it("keeps an account wall that already has art and drops the guest one", async () => {
  const { owner, transport, repository } = await signIn(hungWall);
  await publishClaimedWall(repository);
  expect(transport.setLayout).not.toHaveBeenCalled();
  expect(repository.getSnapshot().acknowledged).toEqual(hungWall);
  expect(await getSetting(`wall:${owner}`)).toBeUndefined();
});

it("shows the claimed wall without locking it while the account's journal finishes syncing", async () => {
  const { owner, transport, repository } = await signIn(emptyWall);
  const sync = holdSync();
  const publishing = publishClaimedWall(repository);
  await sync.running;
  expect(repository.getSnapshot()).toMatchObject({ pending: false, layoutDraft: { color: guestWall.color } });
  await repository.refresh();
  expect(transport.setLayout).not.toHaveBeenCalled();

  sync.finish();
  await publishing;
  expect(transport.setLayout).toHaveBeenCalledTimes(1);
  expect(await getSetting(`wall:${owner}`)).toBeUndefined();
});

it("lets an edit during the sync replace the guest wall, even one that takes every piece down", async () => {
  const { owner, transport, repository } = await signIn(emptyWall);
  const sync = holdSync();
  const publishing = publishClaimedWall(repository);
  await sync.running;
  repository.setLayoutDraft({ color: guestWall.color, items: [] });
  await repository.publishLayout();

  sync.finish();
  await publishing;
  expect(transport.setLayout).toHaveBeenCalledTimes(1);
  expect(await getSetting(`wall:${owner}`)).toBeUndefined();

  await repository.refresh();
  await publishClaimedWall(repository);
  expect(transport.setLayout).toHaveBeenCalledTimes(1);
});

it("keeps the guest wall for the next read when its screen closes during the sync", async () => {
  const { owner, transport, repository } = await signIn(emptyWall);
  const sync = holdSync();
  const publishing = publishClaimedWall(repository);
  await sync.running;
  repository.dispose();
  sync.finish();
  await publishing;
  expect(transport.setLayout).not.toHaveBeenCalled();
  expect(await getSetting(`wall:${owner}`)).toBe(JSON.stringify(guestWall));
});

it("keeps the guest wall for the next read when publishing fails", async () => {
  const { owner, transport, repository } = await signIn(emptyWall);
  transport.setLayout.mockRejectedValueOnce(new Error("Server unavailable"));
  await publishClaimedWall(repository);
  expect(reportError).toHaveBeenCalledWith(expect.any(Error), "wall.claimed.publish");
  expect(repository.getSnapshot()).toMatchObject({ layoutDraft: null, pending: false, acknowledged: emptyWall });
  expect(await getSetting(`wall:${owner}`)).toBe(JSON.stringify(guestWall));

  await publishClaimedWall(repository);
  expect(transport.setLayout).toHaveBeenCalledTimes(2);
  expect(await getSetting(`wall:${owner}`)).toBeUndefined();
});

it("never publishes a signed-out owner's wall", async () => {
  switchOwner("device:claimed-guest", "guest-scope");
  await insertSavedWork({ localId: "kept", savedAt: 1, title: "Water Lilies", artist: "Claude Monet" });
  await setSetting("wall:device:claimed-guest", JSON.stringify(guestWall));
  const repository = createLocalWallRepository();
  repository.connect();
  await repository.refresh();
  const before = repository.getSnapshot();
  await publishClaimedWall(repository);
  expect(repository.getSnapshot()).toBe(before);
  expect(await getSetting("wall:device:claimed-guest")).toBe(JSON.stringify(guestWall));
});
