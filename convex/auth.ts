import { ConvexCredentials } from '@convex-dev/auth/providers/ConvexCredentials';
import { convexAuth, createAccount } from '@convex-dev/auth/server';
import { ConvexError } from 'convex/values';

const anonymous = ConvexCredentials({
  id: 'anonymous',
  authorize: async (params, ctx) => {
    const { secret } = params;
    if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret)) {
      throw new ConvexError({ code: 'invalid_device_credential' });
    }
    // The phone keeps a random 256-bit credential; only its hash is stored on the server.
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
    const accountId = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const { user } = await createAccount(ctx, {
      provider: 'anonymous',
      account: { id: accountId },
      profile: { isAnonymous: true },
    });
    return { userId: user._id };
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [anonymous],
});
