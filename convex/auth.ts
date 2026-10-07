import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { convexAuth, createAccount } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";

import { internal } from "./_generated/api";
import { verifyAppleIdentityToken } from "./lib/appleToken";
import { authUserId } from "./lib/auth";
import { verifyGoogleIdentityToken } from "./lib/googleToken";
import type { AccountProvider } from "./lib/validators";

const anonymous = ConvexCredentials({
  id: "anonymous",
  authorize: async (params, ctx) => {
    const { secret } = params;
    if (typeof secret !== "string" || !/^[a-f0-9]{64}$/.test(secret)) {
      throw new ConvexError({ code: "invalid_device_credential" });
    }
    // The phone keeps a random 256-bit credential; only its hash is stored on the server.
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
    const accountId = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const { user } = await createAccount(ctx, {
      provider: "anonymous",
      account: { id: accountId },
      profile: { isAnonymous: true },
    });
    return { userId: user._id };
  },
});

const nativeProvider = (provider: AccountProvider) =>
  ConvexCredentials({
    id: `${provider}-native`,
    authorize: async (params, ctx) => {
      // Convex Auth replaces ctx.auth inside credentials providers; internal calls retain the caller identity.
      const device = await ctx.runQuery(internal.devices.getForCaller, {});
      if (!device?.authUserId || device.banned) {
        throw new ConvexError({ code: "device_not_registered" });
      }
      const userId = device.authUserId;
      if (typeof params.identityToken !== "string" || typeof params.nonce !== "string") {
        throw new ConvexError({ code: `invalid_${provider}_identity` });
      }
      const { sub, email } =
        provider === "apple"
          ? await verifyAppleIdentityToken(params.identityToken, params.nonce)
          : await verifyGoogleIdentityToken(params.identityToken);
      await ctx.runMutation(internal.nativeLogin.recordVerifiedIdentity, {
        provider,
        sub,
        email,
        nonce: params.nonce,
      });
      await createAccount(ctx, {
        provider: `${provider}-native`,
        account: { id: sub },
        profile: email ? { email } : {},
        shouldLinkViaEmail: false,
        shouldLinkViaPhone: false,
      });
      // Auth associations belong to the first device. Subsequent sessions keep their own device user.
      return { userId };
    },
  });

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [anonymous, nativeProvider("apple"), nativeProvider("google")],
  callbacks: {
    createOrUpdateUser: async (ctx, args) => {
      if (args.provider.id === "apple-native" || args.provider.id === "google-native") {
        const current = await authUserId(ctx);
        if (!current) throw new ConvexError({ code: "unauthenticated" });
        return current;
      }
      return args.existingUserId ?? ctx.db.insert("users", { isAnonymous: true });
    },
  },
});
