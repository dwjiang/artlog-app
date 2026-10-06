import { waitFor } from "@testing-library/react-native";
import { ConvexError } from "convex/values";

import { captureOwner, subscribeOwner, switchOwner } from "@/lib/account/owner-store";
import { addBreadcrumb, reportError } from "@/lib/observability";
import { STARTER_WALLS } from "@/shared/wall/defaults";

import { createVisitSharingController } from "./visit-sharing-controller";
import type { ShareState, VisitSharingTransport } from "./visit-sharing-transport";

jest.mock("@/lib/observability", () => ({
  reportError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));
const initial: ShareState = {
  audience: "public",
  status: "private",
  postId: null,
  removed: false,
  reflection: "",
  saveLocalIds: [],
  revision: 0,
  companions: [],
};
const transport = {
  getState: jest.fn(),
  publish: jest.fn(),
} satisfies VisitSharingTransport;
const flush = jest.fn();
let controller: ReturnType<typeof createVisitSharingController>;
let ids: string[];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  jest.clearAllMocks();
  switchOwner("account:a", "scope-a");
  ids = Array.from({ length: 60 }, (_, i) => `save-${i}`);
  transport.getState.mockResolvedValue(initial);
  transport.publish.mockResolvedValue({
    ...initial,
    status: "active",
    postId: "post",
    revision: 1,
  });
  flush.mockResolvedValue(undefined);
  controller = createVisitSharingController({
    visitLocalId: "visit",
    saveLocalIds: () => ids,
    transport,
    flush,
    capture: () => ({ ...captureOwner(), token: "token" }),
    subscribeOwner,
  });
  controller.connect();
});
afterEach(() => controller.dispose());

it("selects at most 50 artworks, uses the saved public notes, and allows zero", async () => {
  transport.getState.mockResolvedValue({
    ...initial,
    reflection: "For friends",
  });
  await controller.load();
  expect(controller.getSnapshot().draft?.saveLocalIds).toHaveLength(50);
  expect(controller.getSnapshot().draft?.reflection).toBe("For friends");
  controller.edit({ saveLocalIds: [] });
  await controller.publish();
  expect(transport.publish).toHaveBeenCalledWith(
    {
      audience: "public",
      visitLocalId: "visit",
      saveLocalIds: [],
      reflection: "For friends",
      revision: 0,
      photoSelections: [],
      color: expect.stringMatching(/^#[0-9A-F]{6}$/),
      pattern: expect.any(String),
      companionIds: [],
    },
    expect.anything(),
  );
});

it("starts from the published companions and posts the friends picked, up to ten", async () => {
  const person = (profileId: string) =>
    ({
      profileId,
      name: profileId,
      username: profileId,
      avatar: "vermeer" as const,
      publishedWallCount: 0,
    }) as ShareState["companions"][number];
  transport.getState.mockResolvedValue({ ...initial, status: "active", postId: "post", companions: [person("maya")] });
  await controller.load();
  expect(controller.getSnapshot().draft?.companionIds).toEqual(["maya"]);

  controller.edit({ companionIds: Array.from({ length: 11 }, (_, index) => `friend-${index}`) as never });
  expect(controller.getSnapshot().draft?.companionIds).toEqual(["maya"]);
  controller.edit({ companionIds: ["maya", "jonah"] as never });
  await controller.publish();
  expect(transport.publish).toHaveBeenCalledWith(
    expect.objectContaining({ companionIds: ["maya", "jonah"] }),
    expect.anything(),
  );
});

it("starts a first post on a starter wallpaper, keeps a posted visit's wallpaper, and posts the chosen one", async () => {
  await controller.load();
  expect(STARTER_WALLS).toContainEqual({
    color: controller.getSnapshot().draft?.color,
    pattern: controller.getSnapshot().draft?.pattern,
  });
  controller.dispose();
  transport.getState.mockResolvedValue({ ...initial, status: "active", postId: "post", revision: 2, color: "#4C5B6B" });
  controller.connect();
  await controller.load();
  expect(controller.getSnapshot().draft).toMatchObject({ color: "#4C5B6B", pattern: undefined });
  controller.edit({ color: "#6C2F2B", pattern: "dots" });
  await controller.publish();
  expect(transport.publish).toHaveBeenCalledWith(
    expect.objectContaining({ color: "#6C2F2B", pattern: "dots" }),
    expect.anything(),
  );
});

it("flushes before every request and sends no request when sync fails", async () => {
  flush.mockRejectedValueOnce(new Error("offline"));
  expect(await controller.load()).toBe(false);
  expect(transport.getState).not.toHaveBeenCalled();
  const gate = deferred<void>();
  flush.mockReturnValueOnce(gate.promise);
  const load = controller.load();
  expect(transport.getState).not.toHaveBeenCalled();
  gate.resolve();
  await load;
  expect(transport.getState).toHaveBeenCalledTimes(1);
});

it("clears a failed load's error while its retry runs and after it succeeds", async () => {
  flush.mockRejectedValueOnce(new Error("offline"));
  await controller.load();
  expect(controller.getSnapshot().error).toBeDefined();
  const gate = deferred<void>();
  flush.mockReturnValueOnce(gate.promise);
  const retry = controller.load();
  expect(controller.getSnapshot()).toMatchObject({ busy: true, error: undefined });
  gate.resolve();
  expect(await retry).toBe(true);
  expect(controller.getSnapshot()).toMatchObject({ busy: false, error: undefined });
});

it("posts the notes as the visit last saved them", async () => {
  transport.getState.mockResolvedValueOnce({ ...initial, reflection: "Before" });
  await controller.load();
  transport.getState.mockResolvedValueOnce({ ...initial, reflection: "Edited on the share screen" });
  expect(await controller.publish()).toBe(true);
  expect(transport.publish).toHaveBeenCalledWith(
    expect.objectContaining({ reflection: "Edited on the share screen" }),
    expect.anything(),
  );
});

it("preserves selection and reflection on network failure", async () => {
  transport.getState.mockResolvedValue({ ...initial, reflection: "My draft" });
  await controller.load();
  controller.edit({ saveLocalIds: ["save-2"] });
  transport.publish.mockRejectedValueOnce(new Error("Network request failed"));
  expect(await controller.publish()).toBe(false);
  expect(controller.getSnapshot()).toMatchObject({
    draft: { saveLocalIds: ["save-2"], reflection: "My draft" },
  });
});

it("reports a conflict and posts over it with the latest notes while keeping the selected artworks", async () => {
  transport.getState.mockResolvedValue({ ...initial, reflection: "Keep this" });
  await controller.load();
  controller.edit({ saveLocalIds: [] });
  transport.publish.mockRejectedValueOnce(new ConvexError({ code: "conflict" }));
  expect(await controller.publish()).toBe(false);
  expect(controller.getSnapshot().conflict).toBe(true);
  transport.getState.mockResolvedValueOnce({ ...initial, revision: 7, reflection: "Other device" });
  expect(await controller.publish()).toBe(true);
  expect(controller.getSnapshot().conflict).toBe(false);
  expect(transport.publish).toHaveBeenLastCalledWith(
    expect.objectContaining({ revision: 7, reflection: "Other device", saveLocalIds: [] }),
    expect.anything(),
  );
});

it("aborts and clears private state on account changes and discards a late mutation acknowledgement", async () => {
  await controller.load();
  const gate = deferred<ShareState>();
  transport.publish.mockReturnValueOnce(gate.promise);
  const publish = controller.publish();
  await waitFor(() => expect(transport.publish).toHaveBeenCalled());
  const { signal } = transport.publish.mock.calls[0][1];
  switchOwner("account:b", "scope-b");
  expect(signal.aborted).toBe(true);
  gate.resolve({ ...initial, status: "active", revision: 1 });
  expect(await publish).toBe(false);
  expect(controller.getSnapshot()).toMatchObject({
    acknowledged: null,
    draft: null,
    busy: false,
  });
  expect(reportError).not.toHaveBeenCalled();
});

it("ignores artworks that are not part of the visit", async () => {
  await controller.load();
  controller.edit({ saveLocalIds: ["foreign-save"] });
  expect(controller.getSnapshot().draft?.saveLocalIds).not.toContain("foreign-save");
});

it("loads an existing share for editing and waits for an acknowledged publish", async () => {
  transport.getState.mockResolvedValue({
    ...initial,
    postId: "post",
    status: "active",
    saveLocalIds: ["save-1"],
    reflection: "Already shared",
    revision: 3,
  });
  await controller.load();
  expect(controller.getSnapshot().draft).toMatchObject({
    saveLocalIds: ["save-1"],
    reflection: "Already shared",
    revision: 3,
  });
  const gate = deferred<ShareState>();
  transport.publish.mockReturnValueOnce(gate.promise);
  const request = controller.publish();
  await waitFor(() => expect(transport.publish).toHaveBeenCalled());
  expect(controller.getSnapshot().acknowledged?.revision).toBe(3);
  gate.resolve({
    ...initial,
    postId: "post",
    status: "active",
    saveLocalIds: ["save-1"],
    reflection: "Already shared",
    revision: 4,
  });
  await request;
  expect(controller.getSnapshot().acknowledged?.revision).toBe(4);
});

it("surfaces profile requirements and refuses anonymous sharing", async () => {
  transport.getState.mockRejectedValueOnce(new ConvexError({ code: "profile_required" }));
  await controller.load();
  expect(controller.getSnapshot().profileRequired).toBe(true);
  switchOwner("device:guest", "guest");
  await controller.load();
  expect(transport.getState).toHaveBeenCalledTimes(1);
});

it("starts from the visit's audience and posts the one chosen", async () => {
  await controller.load();
  expect(controller.getSnapshot().draft?.audience).toBe("public");
  controller.edit({ audience: "friends" });
  await controller.publish();
  expect(transport.publish).toHaveBeenCalledWith(expect.objectContaining({ audience: "friends" }), expect.anything());
});

it("seeds the requested audience without publishing and preserves subsequent edits and the published audience", async () => {
  controller.dispose();
  transport.getState.mockResolvedValue({ ...initial, audience: "private" });
  controller = createVisitSharingController({
    visitLocalId: "visit",
    initialAudience: "friends",
    saveLocalIds: () => ids,
    transport,
    flush,
    capture: () => ({ ...captureOwner(), token: "token" }),
    subscribeOwner,
  });
  controller.connect();
  await controller.load();
  expect(controller.getSnapshot().draft?.audience).toBe("friends");
  expect(controller.getSnapshot().acknowledged?.audience).toBe("private");
  expect(transport.publish).not.toHaveBeenCalled();
  controller.edit({ audience: "private" });
  await controller.load();
  expect(controller.getSnapshot().draft?.audience).toBe("private");
  transport.publish.mockResolvedValue({ ...initial, audience: "private", revision: 1 });
  await controller.publish();
  expect(transport.publish).toHaveBeenCalledWith(expect.objectContaining({ audience: "private" }), expect.anything());
  expect(controller.getSnapshot().draft?.audience).toBe("private");
});

it("reports publication failures without attaching the selected artwork or reflection", async () => {
  await controller.load();
  const error = new Error("Unexpected server failure");
  transport.publish.mockRejectedValueOnce(error);
  expect(await controller.publish()).toBe(false);
  expect(reportError).toHaveBeenCalledWith(error, "visit.sharing.publish");
  expect(controller.getSnapshot().draft).not.toBeNull();
  expect(addBreadcrumb).toHaveBeenCalledWith("visit.sharing.publish.started");
  expect(addBreadcrumb).not.toHaveBeenCalledWith("visit.sharing.publish.completed");
});

it("reports a timed-out load and releases the busy state for retry", async () => {
  jest.useFakeTimers();
  try {
    transport.getState.mockImplementationOnce(() => new Promise(() => {}));
    const pending = controller.load();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(await pending).toBe(false);
    expect(controller.getSnapshot().busy).toBe(false);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Visit sharing timed out" }),
      "visit.sharing.load",
    );
  } finally {
    jest.useRealTimers();
  }
});
