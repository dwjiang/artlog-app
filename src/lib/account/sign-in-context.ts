export const signInContexts = {
  account: {
    title: "Sign in to Artlog",
    detail: "Sync your collection, share your wall, and connect with friends.",
  },
  friends: {
    title: "Sign in to follow friends",
    detail: "See the museum visits and artworks your friends share.",
  },
  wall: {
    title: "Sign in to share your wall",
    detail: "Create a public profile, then choose which artworks to show.",
  },
  leaderboards: {
    title: "Sign in to see friends’ rankings",
    detail: "Find your friends on the leaderboards. You choose whether to share your activity totals.",
  },
  visit: {
    title: "Sign in to share this visit",
    detail: "You choose what to include before it’s published.",
  },
  reactions: {
    title: "Sign in to join the conversation",
    detail: "Like museum visits and leave comments with your public profile.",
  },
} as const;

export type SignInContext = keyof typeof signInContexts;

export function signInRoute(context: SignInContext, visitId?: string, audience?: "friends") {
  return {
    pathname: "/sign-in" as const,
    params: { context, ...(visitId ? { visitId, ...(audience ? { audience } : {}) } : {}) },
  };
}

export function readSignInContext(value?: string): SignInContext {
  return value && Object.hasOwn(signInContexts, value) ? (value as SignInContext) : "account";
}
