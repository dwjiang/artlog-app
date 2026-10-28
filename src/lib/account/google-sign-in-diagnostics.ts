const domains = new Set([
  "com.google.GIDSignIn",
  "org.openid.appauth.general",
  "org.openid.appauth.oauth_authorization",
  "org.openid.appauth.oauth_token",
  "com.apple.AuthenticationServices.WebAuthenticationSession",
  "NSURLErrorDomain",
  "NSCocoaErrorDomain",
]);
const bridgeCodes = new Set(["NULL_PRESENTER", "SIGN_IN_ERROR", "configure", "IN_PROGRESS"]);

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function code(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && Math.abs(value) <= 999_999) return String(value);
  if (typeof value === "string" && (/^-?\d{1,6}$/.test(value) || bridgeCodes.has(value))) return value;
}

export function googleSignInCancelled(error: unknown): boolean {
  try {
    return code(object(error)?.code) === "-5";
  } catch {
    return false;
  }
}

export function googleSignInErrorData(error: unknown): Record<string, string> {
  const data: Record<string, string> = {};
  try {
    let current = object(error);
    // React Native serializes NSError's underlying chain here. No messages, URLs,
    // native stacks or arbitrary userInfo values cross this allowlist.
    for (let depth = 0; current && depth < 3; depth++) {
      const prefix = depth === 0 ? "native" : `underlying_${depth}`;
      const errorCode = code(current.code);
      data[`${prefix}_code`] = errorCode ?? "unknown";
      data[`${prefix}_domain`] =
        typeof current.domain === "string" && domains.has(current.domain) ? current.domain : "unknown";
      current = object(object(current.userInfo)?.NSUnderlyingError);
    }
  } catch {
    // Even unusual native error objects must not replace the sign-in failure.
  }
  return data;
}
