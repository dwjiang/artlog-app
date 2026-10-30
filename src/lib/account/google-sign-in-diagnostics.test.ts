import { googleSignInCancelled, googleSignInErrorData, googleSignInMissingWindow } from "./google-sign-in-diagnostics";

it("only keeps numeric or known bridge codes and known native domains", () => {
  expect(googleSignInErrorData({ code: "person@example.com", domain: "private-account", message: "secret" })).toEqual({
    native_code: "unknown",
    native_domain: "unknown",
  });
  expect(googleSignInErrorData({ code: "NULL_PRESENTER", domain: "com.google.GIDSignIn" })).toEqual({
    native_code: "NULL_PRESENTER",
    native_domain: "com.google.GIDSignIn",
  });
  expect(googleSignInErrorData({ code: Infinity })).toEqual({ native_code: "unknown", native_domain: "unknown" });
});

it("bounds an underlying-error cycle and does not serialize userInfo or arbitrary properties", () => {
  const error: Record<string, unknown> = { code: -3, domain: "org.openid.appauth.general", token: "secret" };
  error.userInfo = { NSUnderlyingError: error, account: "private" };
  const data = googleSignInErrorData(error);
  expect(Object.keys(data)).toHaveLength(6);
  expect(data.underlying_2_code).toBe("-3");
  expect(JSON.stringify(data)).not.toMatch(/secret|private|token|userInfo/);
});

it("survives unexpected getters and recognizes only the known cancellation code", () => {
  const error = {
    get code() {
      throw new Error("unreadable");
    },
  };
  expect(() => googleSignInErrorData(error)).not.toThrow();
  expect(googleSignInCancelled(error)).toBe(false);
  expect(googleSignInCancelled({ code: -5 })).toBe(true);
  expect(googleSignInCancelled({ code: "-5" })).toBe(true);
  expect(googleSignInCancelled({ code: -3 })).toBe(false);
});

it("recognizes only presenter and browser-start failures as a missing window", () => {
  const safari = "Unable to open Safari.";
  expect(googleSignInMissingWindow({ code: "NULL_PRESENTER" })).toBe(true);
  expect(googleSignInMissingWindow({ code: "-1", userInfo: { NSLocalizedDescription: safari } })).toBe(true);
  expect(googleSignInMissingWindow({ code: -1, message: `RNGoogleSignIn: Unknown error, "${safari}"` })).toBe(true);
  expect(googleSignInMissingWindow({ code: "-1", message: "The network connection was lost." })).toBe(false);
  expect(googleSignInMissingWindow({ code: "-5", message: safari })).toBe(false);
  expect(
    googleSignInMissingWindow({
      get code() {
        throw new Error("unreadable");
      },
    }),
  ).toBe(false);
});
