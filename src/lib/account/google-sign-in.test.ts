import { GoogleSignin } from "@react-native-google-signin/google-signin";

const originalIos = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const originalWeb = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

function loadSignIn() {
  let module!: typeof import("./google-sign-in");
  jest.isolateModules(() => {
    module = jest.requireActual("./google-sign-in");
  });
  return module;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = "ios-client.apps.googleusercontent.com";
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = "web-client.apps.googleusercontent.com";
});

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
