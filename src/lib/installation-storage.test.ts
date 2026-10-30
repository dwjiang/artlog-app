const mockFiles = new Map<string, string>();
const mockKeychain = new Map<string, string>();
const mockWrite = jest.fn();
const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
const mockDeleteItem = jest.fn();
const mockRandomUUID = jest.fn();
const mockRandomBytes = jest.fn();
const mockReportError = jest.fn();

jest.mock("expo-file-system", () => ({
  Paths: { document: "documents" },
  File: class {
    uri: string;
    constructor(...parts: string[]) {
      this.uri = parts.join("/");
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    textSync() {
      return mockFiles.get(this.uri);
    }
    writeSync(value: string) {
      mockWrite(this.uri, value);
    }
  },
}));
jest.mock("expo-crypto", () => ({
  randomUUID: () => mockRandomUUID(),
  getRandomBytesAsync: () => mockRandomBytes(),
}));
jest.mock("./observability", () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: (...args: unknown[]) => mockGetItem(...args),
  setItemAsync: (...args: unknown[]) => mockSetItem(...args),
  deleteItemAsync: (...args: unknown[]) => mockDeleteItem(...args),
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
}));

function launch() {
  let modules!: {
    storage: typeof import("./installation-storage").installationStorage;
    getSecret: typeof import("./device-credentials").getDeviceAuthSecret;
  };
  jest.isolateModules(() => {
    modules = {
      storage: jest.requireActual("./installation-storage").installationStorage,
      getSecret: jest.requireActual("./device-credentials").getDeviceAuthSecret,
    };
  });
  return modules;
}

beforeEach(() => {
  jest.resetAllMocks();
  mockFiles.clear();
  mockKeychain.clear();
  mockRandomUUID.mockReturnValueOnce("install-a").mockReturnValue("install-b");
  mockRandomBytes.mockResolvedValueOnce(new Uint8Array(32).fill(0xa1)).mockResolvedValue(new Uint8Array(32).fill(0xb2));
  mockWrite.mockImplementation((path: string, value: string) => mockFiles.set(path, value));
  mockGetItem.mockImplementation(async (key: string) => mockKeychain.get(key) ?? null);
  mockSetItem.mockImplementation(async (key: string, value: string) => {
    mockKeychain.set(key, value);
  });
  mockDeleteItem.mockImplementation(async (key: string) => {
    mockKeychain.delete(key);
  });
});

it("keeps auth tokens, the installation credential, and the attestation key across relaunches", async () => {
  const first = launch();
  const secret = await first.getSecret();
  await first.storage.setItem("token", "session");
  await first.storage.setItem("refreshToken", "refresh");
  await first.storage.setItem("appAttestKeyId", "native-key");

  const next = launch();
  expect(await next.getSecret()).toBe(secret);
  expect(await next.storage.getItem("token")).toBe("session");
  expect(await next.storage.getItem("refreshToken")).toBe("refresh");
  expect(await next.storage.getItem("appAttestKeyId")).toBe("native-key");
  expect(mockRandomUUID).toHaveBeenCalledTimes(1);
  expect(mockRandomBytes).toHaveBeenCalledTimes(1);
  // Readable while the phone is locked, so a background token refresh still finds the session.
  expect(mockSetItem.mock.calls.every((call) => call[2].keychainAccessible === 1)).toBe(true);
});

it("starts a new identity after reinstall even when the old Keychain entries survive", async () => {
  const first = launch();
  const oldSecret = await first.getSecret();
  await first.storage.setItem("token", "old-session");
  await first.storage.setItem("refreshToken", "old-refresh");
  await first.storage.setItem("appAttestKeyId", "deleted-native-key");
  const oldEntries = [...mockKeychain.entries()];

  mockFiles.clear();
  const reinstalled = launch();
  expect(await reinstalled.storage.getItem("token")).toBeNull();
  expect(await reinstalled.storage.getItem("refreshToken")).toBeNull();
  expect(await reinstalled.storage.getItem("appAttestKeyId")).toBeNull();
  expect(await reinstalled.getSecret()).not.toBe(oldSecret);
  for (const [key, value] of oldEntries) {
    expect(mockKeychain.get(key)).toBe(value);
  }

  await reinstalled.storage.setItem("appAttestKeyId", "replacement-key");
  await reinstalled.storage.removeItem("appAttestKeyId");
  expect(await reinstalled.storage.getItem("appAttestKeyId")).toBeNull();
});

it("does not access credentials until the installation ID is persisted, and can retry a failed write", async () => {
  mockWrite.mockImplementationOnce(() => {
    throw new Error("disk full");
  });
  const app = launch();
  await expect(app.storage.getItem("token")).rejects.toThrow("disk full");
  expect(mockGetItem).not.toHaveBeenCalled();
  await app.storage.setItem("token", "session");
  expect(await launch().storage.getItem("token")).toBe("session");
});

it("reports a Keychain failure behind the saved session by step and item, without the key, then rethrows it", async () => {
  const { convexAuthStorage } = jest.requireActual<typeof import("./installation-storage")>("./installation-storage");
  const failure = new Error("User interaction is not allowed.");
  mockGetItem.mockRejectedValueOnce(failure);
  await expect(convexAuthStorage.getItem("__convexAuthJWT_httpsexampleconvexcloud")).rejects.toBe(failure);
  expect(mockReportError).toHaveBeenCalledWith(failure, "auth.session_storage", {
    data: { stage: "get", item: "jwt", app_state: expect.anything() },
  });
  expect(JSON.stringify(mockReportError.mock.calls)).not.toContain("httpsexample");
  mockSetItem.mockRejectedValueOnce(failure);
  await expect(convexAuthStorage.setItem("__convexAuthRefreshToken_x", "secret")).rejects.toBe(failure);
  expect(mockReportError).toHaveBeenLastCalledWith(failure, "auth.session_storage", {
    data: { stage: "set", item: "refresh", app_state: expect.anything() },
  });
  await expect(convexAuthStorage.setItem("__convexAuthJWT_x", "jwt")).resolves.toBeUndefined();
  expect(mockReportError).toHaveBeenCalledTimes(2);
});
