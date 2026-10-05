import { act, renderHook, waitFor } from "@testing-library/react-native";

import * as settings from "@/db/repos/settings";
import { removeSetting } from "@/db/repos/settings";
import { reportError } from "@/lib/observability";
import { isAvatarId } from "@/shared/social/avatars";

import {
  getLocalProfile,
  getLocalProfileName,
  setLocalProfileAvatar,
  setLocalProfileName,
  setLocalProfilePhoto,
  useLocalProfile,
} from "./local-profile";
import { anonymousOwner, switchOwner } from "./owner-store";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
const mockFiles = new Set<string>();
const mockDeleteFailures = new Set<string>();
let mockUuid = 0;
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));
jest.mock("expo-crypto", () => ({ randomUUID: () => `photo-${++mockUuid}` }));
jest.mock("expo-file-system", () => {
  const path = (parent: { uri: string } | string, name?: string) =>
    name === undefined ? String(parent) : `${typeof parent === "string" ? parent : parent.uri}/${name}`;
  return {
    Paths: { document: { uri: "file:///documents" } },
    Directory: class {
      create() {}
    },
    File: class {
      uri: string;
      constructor(parent: { uri: string } | string, name?: string) {
        this.uri = path(parent, name);
      }
      get exists() {
        return mockFiles.has(this.uri);
      }
      delete() {
        if (mockDeleteFailures.has(this.uri)) throw new Error("File could not be deleted");
        mockFiles.delete(this.uri);
      }
      async copy(target: { uri: string }) {
        if (!mockFiles.has(this.uri)) throw new Error("File is missing");
        mockFiles.add(target.uri);
      }
      async move(target: { uri: string }) {
        if (!mockFiles.has(this.uri)) throw new Error("File is missing");
        mockFiles.delete(this.uri);
        mockFiles.add(target.uri);
        this.uri = target.uri;
      }
    },
  };
});

beforeEach(async () => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  await removeSetting("local-profile-name");
  await removeSetting("local-profile-photo");
  await removeSetting("local-profile-avatar");
  mockFiles.clear();
  mockDeleteFailures.clear();
  mockUuid = 0;
  switchOwner(anonymousOwner());
});

it("keeps the chosen name across fresh reads and account changes", async () => {
  expect(await getLocalProfileName()).toBeUndefined();
  await setLocalProfileName("  Alex Rivera  ");
  switchOwner("account:alex");
  expect(await getLocalProfileName()).toBe("Alex Rivera");
  switchOwner(anonymousOwner());
  await jest.isolateModulesAsync(async () => {
    const profile = jest.requireActual<typeof import("./local-profile")>("./local-profile");
    expect(await profile.getLocalProfileName()).toBe("Alex Rivera");
  });
});

it("rejects a name over the limit without replacing the saved name", async () => {
  await setLocalProfileName("Alex");
  await expect(setLocalProfileName("a".repeat(61))).rejects.toThrow("Enter a name");
  expect(await getLocalProfileName()).toBe("Alex");
});

it.each(["", "   "])("clears the saved name when given a blank one", async (name) => {
  await setLocalProfileName("Alex");
  await setLocalProfileName(name);
  expect(await getLocalProfileName()).toBeUndefined();
});

it("updates mounted profiles after saving and restores the name on remount", async () => {
  const first = await renderHook(useLocalProfile);
  await waitFor(() => expect(first.result.current.loading).toBe(false));
  await act(() => setLocalProfileName("Alex"));
  expect(first.result.current.name).toBe("Alex");
  await first.unmount();
  const next = await renderHook(useLocalProfile);
  await waitFor(() =>
    expect(next.result.current).toEqual({
      name: "Alex",
      photoUrl: undefined,
      avatar: first.result.current.avatar,
      loading: false,
    }),
  );
});

it("keeps one painting per installation, and a picked painting replaces the photo", async () => {
  const [first, second] = await Promise.all([getLocalProfile(), getLocalProfile()]);
  expect(isAvatarId(first.avatar)).toBe(true);
  expect(second.avatar).toBe(first.avatar);
  mockFiles.add("file:///cache/first.jpg");
  await setLocalProfilePhoto("file:///cache/first.jpg");
  const mounted = await renderHook(useLocalProfile);
  await waitFor(() => expect(mounted.result.current.photoUrl).toBe("file:///documents/profile/photo-1.jpg"));

  await act(() => setLocalProfileAvatar("klee"));
  await waitFor(() => expect(mounted.result.current).toMatchObject({ avatar: "klee", photoUrl: undefined }));
  expect([...mockFiles]).toEqual([]);
  expect((await getLocalProfile()).avatar).toBe("klee");
});

it("keeps one chosen photo in documents and shows each replacement", async () => {
  const mounted = await renderHook(useLocalProfile);
  await waitFor(() => expect(mounted.result.current.loading).toBe(false));
  expect(mounted.result.current.photoUrl).toBeUndefined();

  mockFiles.add("file:///cache/first.jpg");
  await act(() => setLocalProfilePhoto("file:///cache/first.jpg"));
  await waitFor(() => expect(mounted.result.current.photoUrl).toBe("file:///documents/profile/photo-1.jpg"));
  expect([...mockFiles]).toEqual(["file:///documents/profile/photo-1.jpg"]);

  mockFiles.add("file:///cache/second.jpg");
  await act(() => setLocalProfilePhoto("file:///cache/second.jpg"));
  await waitFor(() => expect(mounted.result.current.photoUrl).toBe("file:///documents/profile/photo-2.jpg"));
  expect([...mockFiles]).toEqual(["file:///documents/profile/photo-2.jpg"]);
  switchOwner("account:alex");
  expect((await getLocalProfile()).photoUrl).toBe("file:///documents/profile/photo-2.jpg");
});

it("keeps the previous photo and chosen draft after a failed save, then retries", async () => {
  mockFiles.add("file:///cache/first.jpg");
  await setLocalProfilePhoto("file:///cache/first.jpg");
  mockFiles.add("file:///cache/retry.jpg");
  jest.spyOn(settings, "setSetting").mockRejectedValueOnce(new Error("Disk write failed"));

  await expect(setLocalProfilePhoto("file:///cache/retry.jpg")).rejects.toThrow("Disk write failed");
  expect((await getLocalProfile()).photoUrl).toBe("file:///documents/profile/photo-1.jpg");
  expect([...mockFiles]).toEqual(["file:///documents/profile/photo-1.jpg", "file:///cache/retry.jpg"]);

  await setLocalProfilePhoto("file:///cache/retry.jpg");
  expect((await getLocalProfile()).photoUrl).toBe("file:///documents/profile/photo-3.jpg");
  expect([...mockFiles]).toEqual(["file:///documents/profile/photo-3.jpg"]);
});

it.each(["file:///documents/profile/photo-1.jpg", "file:///cache/second.jpg"])(
  "keeps a committed photo visible when cleanup fails for %s",
  async (undeletable) => {
    mockFiles.add("file:///cache/first.jpg");
    await setLocalProfilePhoto("file:///cache/first.jpg");
    const mounted = await renderHook(useLocalProfile);
    await waitFor(() => expect(mounted.result.current.loading).toBe(false));
    mockFiles.add("file:///cache/second.jpg");
    mockDeleteFailures.add(undeletable);

    await act(() => setLocalProfilePhoto("file:///cache/second.jpg"));
    await waitFor(() => expect(mounted.result.current.photoUrl).toBe("file:///documents/profile/photo-2.jpg"));
    expect(mockFiles.has("file:///documents/profile/photo-2.jpg")).toBe(true);
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), "account.local_profile.cleanup");
  },
);
