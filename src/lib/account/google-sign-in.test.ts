import { GoogleSignin } from "@react-native-google-signin/google-signin";
import * as Sentry from "@sentry/react-native";
import { AppState } from "react-native";

import { signInPresentationSnapshot } from "../../../modules/sign-in-diagnostics/src";

jest.mock("../../../modules/sign-in-diagnostics/src", () => ({
  signInPresentationSnapshot: jest.fn(async () => ({ snapshot: "available", guidedAccess: false, hasPresenter: true })),
  diagnosticAppState: (value: unknown) =>
    ["active", "inactive", "background"].includes(String(value)) ? value : "unknown",
}));

const originalIos = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const originalWeb = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const presetState = AppState.currentState;

function loadSignIn() {
  let module!: typeof import("./google-sign-in");
  jest.isolateModules(() => {
    module = jest.requireActual("./google-sign-in");
  });
  return module;
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(AppState, { currentState: "active" });
  jest
    .mocked(signInPresentationSnapshot)
    .mockResolvedValue({ snapshot: "available", guidedAccess: false, hasPresenter: true });
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = "ios-client.apps.googleusercontent.com";
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = "web-client.apps.googleusercontent.com";
});

it("reports bounded stage and presentation diagnostics without forwarding native auth content", async () => {
  jest.mocked(GoogleSignin.signIn).mockRejectedValueOnce({
    code: "-3",
    domain: "org.openid.appauth.general",
    message: "Unable to open Safari for private-person with secret-credential",
    userInfo: {
      privateAccount: "private-person",
      NSUnderlyingError: { code: -4, domain: "com.google.GIDSignIn", message: "secret-credential" },
    },
  });
  jest
    .mocked(signInPresentationSnapshot)
    .mockResolvedValueOnce({ snapshot: "available", guidedAccess: true, hasPresenter: true, presenterHasWindow: true })
    .mockResolvedValueOnce({ snapshot: "available", guidedAccess: true, hasPresenter: false });
  const { googleSignIn } = loadSignIn();
  const failure = await googleSignIn().catch((error: unknown) => error);
  expect(failure).toEqual(new Error("Google sign-in failed before identity exchange"));
  expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  const [error, options] = jest.mocked(Sentry.captureException).mock.calls[0];
  expect(options).toMatchObject({
    tags: { operation: "auth.google_sign_in" },
    contexts: {
      operation: {
        diagnostic_version: 2,
        failed_stage: "native_sign_in",
        native_code: "-3",
        native_domain: "org.openid.appauth.general",
        underlying_1_code: "-4",
        underlying_1_domain: "com.google.GIDSignIn",
        before_guidedAccess: true,
        before_presenterHasWindow: true,
        after_hasPresenter: false,
        elapsed_ms: expect.any(Number),
        stage_ms: expect.any(Number),
      },
    },
  });
  const serialized = JSON.stringify({
    message: (error as Error).message,
    options,
    breadcrumbs: jest.mocked(Sentry.addBreadcrumb).mock.calls,
  });
  for (const secret of ["private-person", "secret-credential", "ios-client.apps", "web-client.apps", "userInfo"]) {
    expect(serialized).not.toContain(secret);
  }
});

it("distinguishes sign-out failure from browser presentation", async () => {
  jest.mocked(GoogleSignin.signOut).mockRejectedValueOnce(new Error("private native detail"));
  await expect(loadSignIn().googleSignIn()).rejects.toThrow("before identity exchange");
  expect(GoogleSignin.signIn).not.toHaveBeenCalled();
  expect(Sentry.captureException).toHaveBeenCalledWith(
    expect.any(Error),
    expect.objectContaining({
      contexts: { operation: expect.objectContaining({ failed_stage: "sign_out" }) },
    }),
  );
});

it("records lifecycle changes during native sign-in and removes the listener", async () => {
  let onChange!: (state: "active" | "inactive" | "background") => void;
  const remove = jest.fn();
  const listener = jest.spyOn(AppState, "addEventListener").mockImplementation((_, callback) => {
    onChange = callback;
    return { remove };
  });
  jest.mocked(GoogleSignin.signIn).mockImplementationOnce(async () => {
    onChange("inactive");
    onChange("background");
    onChange("active");
    throw { code: "-3" };
  });
  await expect(loadSignIn().googleSignIn()).rejects.toThrow("before identity exchange");
  expect(Sentry.captureException).toHaveBeenCalledWith(
    expect.any(Error),
    expect.objectContaining({
      contexts: {
        operation: expect.objectContaining({ lifecycle_changes: 3, saw_inactive: true, saw_background: true }),
      },
    }),
  );
  expect(remove).toHaveBeenCalledTimes(1);
  listener.mockRestore();
});

const browserNotStarted = {
  code: "-1",
  domain: "com.google.GIDSignIn",
  message:
    'RNGoogleSignIn: Unknown error in google sign in., Error Domain=com.google.GIDSignIn Code=-1 "Unable to open Safari."',
  userInfo: { NSLocalizedDescription: "Unable to open Safari." },
};

it("retries once when the browser sheet could not start", async () => {
  jest
    .mocked(GoogleSignin.signIn)
    .mockRejectedValueOnce(browserNotStarted)
    .mockResolvedValueOnce({ type: "success", data: { idToken: "token", user: { id: "google-user" } } } as never);
  await expect(loadSignIn().googleSignIn()).resolves.toMatchObject({ identityToken: "token" });
  expect(GoogleSignin.signIn).toHaveBeenCalledTimes(2);
  expect(Sentry.captureException).not.toHaveBeenCalled();
  expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
    expect.objectContaining({
      message: "auth.google_sign_in.native_success",
      data: expect.objectContaining({ active_wait: "none", presentation_retried: true, retry_active_wait: "none" }),
    }),
  );
});

it("reports a repeated browser-start failure with its retry", async () => {
  jest.mocked(GoogleSignin.signIn).mockRejectedValueOnce(browserNotStarted).mockRejectedValueOnce(browserNotStarted);
  await expect(loadSignIn().googleSignIn()).rejects.toThrow("before identity exchange");
  expect(GoogleSignin.signIn).toHaveBeenCalledTimes(2);
  expect(Sentry.captureException).toHaveBeenCalledWith(
    expect.any(Error),
    expect.objectContaining({
      contexts: {
        operation: expect.objectContaining({
          failed_stage: "native_sign_in",
          native_code: "-1",
          presentation_retried: true,
        }),
      },
    }),
  );
});

it("does not report a rejected native cancellation", async () => {
  jest.mocked(GoogleSignin.signIn).mockRejectedValueOnce({ code: "-5", message: "cancelled" });
  await expect(loadSignIn().googleSignIn()).resolves.toBeNull();
  expect(Sentry.captureException).not.toHaveBeenCalled();
});

it("deduplicates the same sanitized error when the account boundary reports it again", async () => {
  let signIn!: typeof import("./google-sign-in").googleSignIn;
  let report!: typeof import("@/lib/observability").reportError;
  jest.isolateModules(() => {
    signIn = jest.requireActual("./google-sign-in").googleSignIn;
    report = jest.requireActual("@/lib/observability").reportError;
  });
  jest.mocked(GoogleSignin.signIn).mockRejectedValueOnce({ code: "-3", message: "private detail" });
  const failure = await signIn().catch((error: unknown) => error);
  report(failure, "auth.google_sign_in");
  expect(Sentry.captureException).toHaveBeenCalledTimes(1);
});

it("does not collapse distinct native errors within the shared report cooldown", async () => {
  const { googleSignIn } = loadSignIn();
  jest
    .mocked(GoogleSignin.signIn)
    .mockRejectedValueOnce({ code: "-3", message: "private" })
    .mockRejectedValueOnce({ code: "-1", message: "private" });
  await expect(googleSignIn()).rejects.toThrow("before identity exchange");
  await expect(googleSignIn()).rejects.toThrow("before identity exchange");
  expect(Sentry.captureException).toHaveBeenCalledTimes(2);
});

it("preserves the existing transient-network exclusion", async () => {
  const offline = new Error("Network request failed");
  jest.mocked(GoogleSignin.signIn).mockRejectedValueOnce(offline);
  await expect(loadSignIn().googleSignIn()).rejects.toBe(offline);
  expect(Sentry.captureException).not.toHaveBeenCalled();
});

it("preserves success with unavailable native diagnostics and keeps credentials out of breadcrumbs", async () => {
  jest.mocked(signInPresentationSnapshot).mockResolvedValueOnce({ snapshot: "unavailable" });
  jest.mocked(GoogleSignin.signIn).mockResolvedValueOnce({
    type: "success",
    data: { idToken: "private-id-token", user: { id: "private-user", name: "Private Name" } },
  } as never);
  await expect(loadSignIn().googleSignIn()).resolves.toMatchObject({ identityToken: "private-id-token" });
  expect(Sentry.captureException).not.toHaveBeenCalled();
  expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
    expect.objectContaining({
      message: "auth.google_sign_in.native_success",
      data: expect.objectContaining({ before_snapshot: "unavailable" }),
    }),
  );
  expect(JSON.stringify(jest.mocked(Sentry.addBreadcrumb).mock.calls)).not.toMatch(
    /private-id-token|private-user|Private Name/,
  );
});

afterAll(() => Object.assign(AppState, { currentState: presetState }));

afterEach(() => {
  if (originalIos === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  else process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = originalIos;
  if (originalWeb === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  else process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = originalWeb;
});

it("uses the iOS and server clients and clears the previous Google account before opening sign-in", async () => {
  jest.mocked(GoogleSignin.signIn).mockResolvedValueOnce({
    type: "success",
    data: { idToken: "token", user: { id: "google-user", name: " Alex " } },
  } as never);
  const { googleSignIn, googleSignInAvailable } = loadSignIn();
  expect(googleSignInAvailable).toBe(true);
  await expect(googleSignIn()).resolves.toEqual({ identityToken: "token", user: "google-user", name: "Alex" });
  expect(GoogleSignin.configure).toHaveBeenCalledWith({
    iosClientId: "ios-client.apps.googleusercontent.com",
    webClientId: "web-client.apps.googleusercontent.com",
  });
  expect(jest.mocked(GoogleSignin.signOut).mock.invocationCallOrder[0]).toBeLessThan(
    jest.mocked(GoogleSignin.signIn).mock.invocationCallOrder[0],
  );
});

it("returns no identity when the native sheet is cancelled", async () => {
  jest.mocked(GoogleSignin.signIn).mockResolvedValueOnce({ type: "cancelled", data: null });
  await expect(loadSignIn().googleSignIn()).resolves.toBeNull();
});

it("rejects a native response without an ID token", async () => {
  jest.mocked(GoogleSignin.signIn).mockResolvedValueOnce({ type: "success", data: { idToken: null } } as never);
  await expect(loadSignIn().googleSignIn()).rejects.toThrow("Google did not return an identity token");
});

it("leaves Google disabled when either client ID is missing", async () => {
  delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  expect(loadSignIn().googleSignInAvailable).toBe(false);
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = "ios-client.apps.googleusercontent.com";
  delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const { googleSignInAvailable, googleSignIn } = loadSignIn();
  expect(googleSignInAvailable).toBe(false);
  await expect(googleSignIn()).rejects.toThrow("not configured");
  expect(GoogleSignin.configure).not.toHaveBeenCalled();
  expect(GoogleSignin.signIn).not.toHaveBeenCalled();
});
