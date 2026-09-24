import * as AppIntegrity from "@expo/app-integrity";

import { getAppAttest } from "./app-attest";

jest.mock("@expo/app-integrity", () => ({
  isSupported: false,
  generateKeyAsync: jest.fn(),
  attestKeyAsync: jest.fn(),
  generateAssertionAsync: jest.fn(),
}));

it("returns null on unsupported devices", () => {
  expect(getAppAttest()).toBeNull();
});

it("passes the original challenge strings to the native implementation", async () => {
  jest.replaceProperty(AppIntegrity, "isSupported", true);
  jest.mocked(AppIntegrity.generateKeyAsync).mockResolvedValue("key");
  jest.mocked(AppIntegrity.attestKeyAsync).mockResolvedValue("attestation");
  jest.mocked(AppIntegrity.generateAssertionAsync).mockResolvedValue("assertion");
  try {
    const attest = getAppAttest()!;
    expect(attest.isSupported()).toBe(true);
    expect(await attest.generateKey()).toBe("key");
    expect(await attest.attestKey("key", "nonce")).toBe("attestation");
    expect(await attest.generateAssertion("key", "nonce.{}")).toBe("assertion");
    expect(AppIntegrity.attestKeyAsync).toHaveBeenCalledWith("key", "nonce");
    expect(AppIntegrity.generateAssertionAsync).toHaveBeenCalledWith("key", "nonce.{}");
  } finally {
    jest.restoreAllMocks();
  }
});
