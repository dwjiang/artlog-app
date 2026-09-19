export const signInContexts = {
  account: { title: 'Sign in to Artlog', detail: 'Share the art you love and connect with friends.' },
  friends: { title: 'Sign in to follow friends', detail: 'See the museum visits and artworks your friends share.' },
  wall: { title: 'Sign in to share your wall', detail: 'Let friends explore the artworks on your public wall.' },
  leaderboards: { title: 'Sign in to connect', detail: 'Find your friends on the leaderboards. You choose whether to share your activity totals.' },
  visit: { title: 'Sign in to share visits', detail: 'Share the museum visits and artworks you choose. Your private journal stays private.' },
} as const;

export type SignInContext = keyof typeof signInContexts;

export function signInRoute(context: SignInContext) {
  return { pathname: '/sign-in' as const, params: { context } };
}

export function readSignInContext(value?: string): SignInContext {
  return value && Object.hasOwn(signInContexts, value) ? value as SignInContext : 'account';
}
