import { ConvexError } from "convex/values";
import { createWallRepository } from "./wall-repository";
import type { OwnerWall, WallTransport } from "./wall-transport";

const wall: OwnerWall = {
  scope: "account:a:1",
  profileId: "profile-a" as never,
  revision: 1,
  color: "#45524B",
  items: [
    {
      itemId: "item-a" as never,
      placementId: "save-a",
      saveLocalId: "save-a",
      layout: { x: 0, y: 0, width: 1, layer: 0, frame: "none" },
      noteVisible: false,
      noteRevision: 0,
      noteEligible: true,
      artwork: {
        title: "Title",
        artist: "Artist",
        media: { kind: "placeholder", width: 1, height: 1 },
      },
    },
  ],
};
const draft = {
  color: "#123456",
  items: wall.items.map(({ placementId, saveLocalId, layout }) => ({
    placementId,
    saveLocalId,
    layout,
  })),
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function fixture() {
  let version = 0,
    owner = "account:a",
    scope = wall.scope,
    changed = () => {};
  const transport = {
    getMine: jest.fn().mockResolvedValue(wall),
    setLayout: jest.fn().mockResolvedValue({ ...wall, revision: 2, color: draft.color }),
    setNoteVisibility: jest.fn().mockResolvedValue(wall),
    listMine: jest.fn().mockResolvedValue({ page: [], cursor: null, isDone: true }),
  } satisfies WallTransport;
  const online = jest.fn().mockResolvedValue(true);
  const repository = createWallRepository({
    transport,
    online,
    capture: () => {
      const captured = version;
      return { owner, scope, token: `token-${owner}`, isCurrent: () => captured === version };
    },
    subscribeOwner: (listener) => {
      changed = listener;
      return () => {
        changed = () => {};
      };
    },
  });
  repository.connect();
  return {
    transport,
    online,
    repository,
    switch: () => {
      version++;
      owner = "account:b";
      scope = "account:b:2";
      changed();
    },
  };
}

it("keeps drafts separate and updates acknowledged state only after the server replies", async () => {
  const { repository, transport } = fixture();
  await repository.refresh();
  repository.setLayoutDraft(draft);
  repository.setNoteDraft([{ itemId: wall.items[0].itemId, visible: true }]);
  expect(repository.getSnapshot().acknowledged).toEqual(wall);
  const pending = deferred<OwnerWall>();
  transport.setLayout.mockReturnValueOnce(pending.promise);
  const publishing = repository.publishLayout();
  expect(repository.getSnapshot()).toMatchObject({ pending: true, acknowledged: wall });
  await Promise.resolve();
  pending.resolve({ ...wall, revision: 2 });
  await publishing;
  expect(repository.getSnapshot()).toMatchObject({
    pending: false,
    layoutDraft: null,
    noteDraft: [{ visible: true }],
    acknowledged: { revision: 2 },
  });
  expect(transport.setLayout.mock.calls[0][0]).toEqual({
    ...draft,
    scope: wall.scope,
    revision: 1,
  });
  repository.dispose();
});

it("preserves newer edits while an earlier draft is being acknowledged", async () => {
  const { repository, transport } = fixture();
  await repository.refresh();
  repository.setLayoutDraft(draft);
  const pending = deferred<OwnerWall>();
  transport.setLayout.mockReturnValueOnce(pending.promise);
  const publishing = repository.publishLayout();
  await Promise.resolve();
  repository.setLayoutDraft({ ...draft, color: "#654321" });
  pending.resolve(wall);
  await publishing;
  expect(repository.getSnapshot().layoutDraft?.color).toBe("#654321");
  repository.dispose();
});

it("leaves drafts in memory offline and never replays publication after reconnect", async () => {
  const { repository, transport, online } = fixture();
  await repository.refresh();
  repository.setLayoutDraft(draft);
  online.mockResolvedValue(false);
  await expect(repository.publishLayout()).rejects.toThrow("Connect");
  expect(transport.setLayout).not.toHaveBeenCalled();
  online.mockResolvedValue(true);
  await Promise.resolve();
  expect(transport.setLayout).not.toHaveBeenCalled();
  expect(repository.getSnapshot().layoutDraft).toEqual(draft);
  repository.dispose();
});

it("clears owner responses and drafts, aborts requests and rejects acknowledgements from the previous account", async () => {
  const f = fixture();
  await f.repository.refresh();
  f.repository.setLayoutDraft(draft);
  const pending = deferred<OwnerWall>();
  f.transport.setLayout.mockReturnValueOnce(pending.promise);
  const publishing = f.repository.publishLayout();
  await Promise.resolve();
  await Promise.resolve();
  const context = f.transport.setLayout.mock.calls[0][1];
  f.switch();
  expect(context.signal.aborted).toBe(true);
  pending.resolve(wall);
  await expect(publishing).rejects.toThrow("cancelled");
  expect(f.repository.getSnapshot()).toMatchObject({
    acknowledged: null,
    layoutDraft: null,
    noteDraft: [],
    pending: false,
  });
  f.repository.dispose();
});

it("refreshes conflicts and requires a new note confirmation using current revisions", async () => {
  const { repository, transport } = fixture();
  await repository.refresh();
  repository.setNoteDraft([{ itemId: wall.items[0].itemId, visible: true }]);
  transport.setNoteVisibility.mockRejectedValueOnce(new ConvexError({ code: "conflict" }));
  transport.getMine.mockResolvedValueOnce({
    ...wall,
    items: [{ ...wall.items[0], noteRevision: 2 }],
  });
  await expect(repository.publishNotes()).rejects.toMatchObject({ data: { code: "conflict" } });
  expect(repository.getSnapshot()).toMatchObject({
    noteDraft: [],
    needsNoteConfirmation: true,
    acknowledged: { items: [{ noteRevision: 2 }] },
  });
  await repository.publishNotes();
  expect(transport.setNoteVisibility).toHaveBeenCalledTimes(1);
  repository.setNoteDraft([{ itemId: wall.items[0].itemId, visible: true }]);
  await repository.publishNotes();
  expect(transport.setNoteVisibility.mock.calls[1][0].changes[0].noteRevision).toBe(2);
  repository.dispose();
});

it("keeps layout drafts after conflict but clears pending note confirmation", async () => {
  const { repository, transport } = fixture();
  await repository.refresh();
  repository.setLayoutDraft(draft);
  repository.setNoteDraft([{ itemId: wall.items[0].itemId, visible: true }]);
  transport.setLayout.mockRejectedValueOnce(new ConvexError({ code: "conflict" }));
  await expect(repository.publishLayout()).rejects.toThrow();
  expect(repository.getSnapshot()).toMatchObject({
    layoutDraft: draft,
    noteDraft: [],
    needsNoteConfirmation: true,
  });
  repository.dispose();
});

it("keeps the layout draft’s base revision through a notes conflict", async () => {
  const { repository, transport } = fixture();
  await repository.refresh();
  repository.setLayoutDraft(draft);
  repository.setNoteDraft([{ itemId: wall.items[0].itemId, visible: true }]);
  transport.setNoteVisibility.mockRejectedValueOnce(new ConvexError({ code: "conflict" }));
  transport.getMine.mockResolvedValueOnce({
    ...wall,
    revision: 7,
    items: [{ ...wall.items[0], noteRevision: 2 }],
  });
  await expect(repository.publishNotes()).rejects.toMatchObject({ data: { code: "conflict" } });
  await repository.publishLayout();
  expect(transport.setLayout.mock.calls[0][0].revision).toBe(1);
  repository.dispose();
});

it("ignores older reads and rejects collection selections from a switched account", async () => {
  const f = fixture(),
    first = deferred<OwnerWall>();
  f.transport.getMine.mockReturnValueOnce(first.promise);
  const older = f.repository.refresh();
  await Promise.resolve();
  await Promise.resolve();
  f.transport.getMine.mockResolvedValueOnce({ ...wall, revision: 5 });
  await f.repository.refresh();
  first.resolve(wall);
  await older;
  expect(f.repository.getSnapshot().acknowledged?.revision).toBe(5);
  const selections = deferred<{ page: never[]; cursor: null; isDone: true }>();
  f.transport.listMine.mockReturnValueOnce(selections.promise);
  const reading = f.repository.listSelections();
  await Promise.resolve();
  await Promise.resolve();
  f.switch();
  selections.resolve({ page: [], cursor: null, isDone: true });
  await expect(reading).rejects.toThrow("cancelled");
  f.repository.dispose();
});

it("does not send a request if the account changes during connectivity checking", async () => {
  const f = fixture();
  await f.repository.refresh();
  f.repository.setLayoutDraft(draft);
  const online = deferred<boolean>();
  f.online.mockReturnValueOnce(online.promise);
  const publishing = f.repository.publishLayout();
  f.switch();
  online.resolve(true);
  await expect(publishing).rejects.toThrow("cancelled");
  expect(f.transport.setLayout).not.toHaveBeenCalled();
  f.repository.dispose();
});

it("keeps the draft’s original layout revision through background refreshes", async () => {
  const { repository, transport } = fixture();
  await repository.refresh();
  repository.setLayoutDraft(draft);
  transport.getMine.mockResolvedValueOnce({ ...wall, revision: 7 });
  await repository.refresh();
  await repository.publishLayout();
  expect(transport.setLayout.mock.calls[0][0].revision).toBe(1);
  repository.dispose();
});

it("accepts owner wall items as selections without sending owner response fields in layout writes", async () => {
  const { repository, transport } = fixture();
  await repository.refresh();
  repository.setLayoutDraft({ color: draft.color, items: wall.items });
  await repository.publishLayout();
  expect(transport.setLayout.mock.calls[0][0].items).toEqual(draft.items);
  repository.dispose();
});
