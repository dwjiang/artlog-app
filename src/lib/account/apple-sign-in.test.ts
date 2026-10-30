import * as AppleAuthentication from "expo-apple-authentication";
import { AppState } from "react-native";

import { addBreadcrumb } from "@/lib/observability";

import { signInPresentationSnapshot } from "../../../modules/sign-in-diagnostics/src";
import { appleSignIn } from "./apple-sign-in";

jest.mock("expo-apple-authentication", () => ({ signInAsync: jest.fn() }));
jest.mock("@/lib/observability", () => ({ addBreadcrumb: jest.fn() }));
jest.mock("../../../modules/sign-in-diagnostics/src", () => ({
  diagnosticAppState: (value: unknown) => (value === "active" ? "active" : "unknown"),
  signInPresentationSnapshot: jest.fn(),
}));

const presetState = AppState.currentState;

beforeEach(() => {
  jest.resetAllMocks();
  Object.assign(AppState, { currentState: "active" });
  jest
    .mocked(signInPresentationSnapshot)
    .mockResolvedValue({ snapshot: "available", hasApplePresentationWindow: false });
});

afterEach(() => jest.restoreAllMocks());
afterAll(() => Object.assign(AppState, { currentState: presetState }));

it("records a repeated Apple presentation-window failure without logging inputs or error content", async () => {
  const error = Object.assign(new Error("private account content"), {
    code: "ERR_WINDOW_UNAVAILABLE",
    userInfo: "private URL",
  });
  jest.mocked(AppleAuthentication.signInAsync).mockRejectedValue(error);
  const options = { nonce: "private nonce" };
  await expect(appleSignIn("sign_in", options)).rejects.toBe(error);
  expect(AppleAuthentication.signInAsync).toHaveBeenCalledTimes(2);
  expect(AppleAuthentication.signInAsync).toHaveBeenLastCalledWith(options);
  expect(addBreadcrumb).toHaveBeenLastCalledWith(
    "auth.apple_native.failure",
    expect.objectContaining({
      purpose: "sign_in",
      error_code: "ERR_WINDOW_UNAVAILABLE",
      presentation_retried: true,
      before_hasApplePresentationWindow: false,
      after_hasApplePresentationWindow: false,
    }),
  );
  expect(JSON.stringify(jest.mocked(addBreadcrumb).mock.calls)).not.toContain("private");
});

it("retries once when Apple had no window to present on", async () => {
  const credential = {} as AppleAuthentication.AppleAuthenticationCredential;
  jest
    .mocked(AppleAuthentication.signInAsync)
    .mockRejectedValueOnce({ code: "ERR_WINDOW_UNAVAILABLE" })
    .mockResolvedValueOnce(credential);
  await expect(appleSignIn("revocation")).resolves.toBe(credential);
  expect(addBreadcrumb).toHaveBeenLastCalledWith(
    "auth.apple_native.success",
    expect.objectContaining({ active_wait: "none", presentation_retried: true, retry_active_wait: "none" }),
  );
});

it("does not retry other Apple failures", async () => {
  const error = { code: "ERR_REQUEST_FAILED" };
  jest.mocked(AppleAuthentication.signInAsync).mockRejectedValue(error);
  await expect(appleSignIn("sign_in")).rejects.toBe(error);
  expect(AppleAuthentication.signInAsync).toHaveBeenCalledTimes(1);
});

it("returns the original credential without logging its tokens or user", async () => {
  const credential = {
    identityToken: "private token",
    authorizationCode: "private code",
    user: "private user",
  } as AppleAuthentication.AppleAuthenticationCredential;
  jest.mocked(AppleAuthentication.signInAsync).mockResolvedValue(credential);
  await expect(appleSignIn("revocation")).resolves.toBe(credential);
  expect(addBreadcrumb).toHaveBeenLastCalledWith(
    "auth.apple_native.success",
    expect.objectContaining({ purpose: "revocation" }),
  );
  expect(JSON.stringify(jest.mocked(addBreadcrumb).mock.calls)).not.toContain("private");
});

it("does not log cancellation as a failure or take another snapshot", async () => {
  const error = { code: "ERR_REQUEST_CANCELED" };
  jest.mocked(AppleAuthentication.signInAsync).mockRejectedValue(error);
  await expect(appleSignIn("sign_in")).rejects.toBe(error);
  expect(signInPresentationSnapshot).toHaveBeenCalledTimes(1);
  expect(addBreadcrumb).toHaveBeenCalledTimes(1);
});

it("allowlists unknown error codes and bounds invalid timing", async () => {
  jest.spyOn(Date, "now").mockReturnValue(Number.NaN);
  const error = { code: "private error" };
  jest.mocked(AppleAuthentication.signInAsync).mockRejectedValue(error);
  await expect(appleSignIn("sign_in")).rejects.toBe(error);
  expect(addBreadcrumb).toHaveBeenLastCalledWith(
    "auth.apple_native.failure",
    expect.objectContaining({ error_code: "unknown", elapsed_ms: null }),
  );
});

it("preserves successful and failed auth when diagnostic collection or recording throws", async () => {
  jest.mocked(signInPresentationSnapshot).mockRejectedValue(new Error("unavailable"));
  jest.mocked(addBreadcrumb).mockImplementation(() => {
    throw new Error("telemetry");
  });
  const credential = {} as AppleAuthentication.AppleAuthenticationCredential;
  jest.mocked(AppleAuthentication.signInAsync).mockResolvedValueOnce(credential);
  await expect(appleSignIn("sign_in")).resolves.toBe(credential);
  const error = new Error("native failure");
  jest.mocked(AppleAuthentication.signInAsync).mockRejectedValueOnce(error);
  await expect(appleSignIn("sign_in")).rejects.toBe(error);
});
