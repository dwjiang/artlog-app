export const signInTitles = {
  account: "Sign in to Artlog",
  friends: "Sign in to follow friends",
  wall: "Sign in to share your wall",
  leaderboards: "Sign in to see friends’ rankings",
  visit: "Sign in to share this visit",
  reactions: "Sign in to join the conversation",
} as const;

export type SignInContext = keyof typeof signInTitles;

export function signInRoute(context: SignInContext, visitId?: string, audience?: "friends") {
  return {
    pathname: "/sign-in" as const,
    params: { context, ...(visitId ? { visitId, ...(audience ? { audience } : {}) } : {}) },
  };
}

export function readSignInContext(value?: string): SignInContext {
  return value && Object.hasOwn(signInTitles, value) ? (value as SignInContext) : "account";
}
