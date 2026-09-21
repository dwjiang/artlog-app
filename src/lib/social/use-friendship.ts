import { showToast } from '../ui/toast';
import { ConvexHttpClient } from 'convex/browser';
import { fetch as expoFetch } from 'expo/fetch';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { captureOwner } from '../account/owner-store';
import { convexErrorCode } from '../network-error';
import { socialErrorMessage } from '@/shared/social/errors';
import type { FriendshipAction, Relationship } from './types';
import type { SocialSession } from './use-social-session';
import { useSocialQuery } from './use-social-query';

/** A relationship the caller already holds (a browse page embeds one per row), so no per-person subscription opens. */
export type RelationshipSource = { data: Relationship; refresh: () => void };

export function useFriendship(profileId: Id<'profiles'>, session: SocialSession, source?: RelationshipSource) {
  const enabled = session.status === 'ready' && profileId !== session.profileId;
  const own = useSocialQuery(api.friendships.getState, enabled && !source ? { profileId } : 'skip', session.key);
  const query = source ? { ...source, error: undefined } : own;
  const [confirmed, setConfirmed] = useState<Relationship>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, [profileId, session.key]);
  const state = !enabled || query.error || !query.data ? undefined
    : confirmed && confirmed.revision > query.data.revision && confirmed.blockRevision >= query.data.blockRevision ? confirmed : query.data;

  async function act(action: FriendshipAction) {
    if (!enabled || !state || !session.token || request.current) return;
    const owner = captureOwner();
    const controller = new AbortController();
    request.current = controller;
    const current = () => owner.isCurrent() && !controller.signal.aborted;
    // Bind the request to this account's token; never queue a friendship change through a later login.
    const client = new ConvexHttpClient(process.env.EXPO_PUBLIC_CONVEX_URL!, { auth: session.token, logger: false,
      fetch: (input, options) => expoFetch(input, { ...options, signal: controller.signal }) });
    setBusy(true); setError(undefined);
    try {
      const result = await client.mutation(api.friendships[action], { profileId, revision: state.revision }, { skipQueue: true });
      if (current()) { setConfirmed(result); if (action === 'accept') showToast('You’re now friends.'); return true; }
    } catch (cause) {
      if (!current()) return;
      if (convexErrorCode(cause) === 'conflict' || convexErrorCode(cause) === 'invalid_relationship') {
        setConfirmed(undefined);
        setError('This friendship changed. Review the updated options and try again.');
        query.refresh();
      } else setError(socialErrorMessage(cause) ?? 'Couldn’t update this friendship. Check your connection and try again.');
    } finally {
      if (current()) { request.current = null; setBusy(false); }
    }
  }

  return { state, busy, error: error ?? (query.error ? socialErrorMessage(query.error) ?? 'Couldn’t load this friendship.' : undefined),
    act, refresh: () => { setError(undefined); setConfirmed(undefined); query.refresh(); } };
}
