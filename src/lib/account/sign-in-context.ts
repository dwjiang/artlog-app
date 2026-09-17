export const signInContexts = {
  account: { title: 'Sign in to Artlog', detail: 'Sync your collection across devices and share the art you love.' },
  friends: { title: 'Sign in to follow friends', detail: 'See the museum visits and artworks your friends share. Your saved works stay on this phone either way.' },
  wall: { title: 'Sign in to share your wall', detail: 'Your saved works stay on this phone. Signing in syncs them to your other devices and lets friends see your public wall.' },
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
