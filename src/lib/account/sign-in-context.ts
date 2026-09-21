export const signInContexts = {
  account: { title: 'Share your art.', detail: 'Sign in to share your wall and connect with friends. Your collection comes with you.' },
  friends: { title: 'Sign in to follow friends', detail: 'See the museum visits and artworks your friends share.' },
  wall: { title: 'Sign in to share your wall', detail: 'Let friends explore the artworks on your public wall.' },
  leaderboards: { title: 'Sign in to connect', detail: 'Find your friends on the leaderboards. You choose whether to share your activity totals.' },
  visit: { title: 'Share your museum visit.', detail: 'Sign in to publish it. You choose what to include first.' },
} as const;

export type SignInContext = keyof typeof signInContexts;

export function signInRoute(context: SignInContext, visitId?: string) {
  return { pathname: '/sign-in' as const, params: { context, ...(visitId ? { visitId } : {}) } };
}

export function readSignInContext(value?: string): SignInContext {
  return value && Object.hasOwn(signInContexts, value) ? value as SignInContext : 'account';
}
