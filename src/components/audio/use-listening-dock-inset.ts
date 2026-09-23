import { useHasListeningTrack } from '@/lib/audio/use-listening';
import { useVenue } from '@/lib/venue/use-venue';
import { activeVisit } from '@/lib/venue/venue-reducer';
import { MINI_PLAYER_HEIGHT } from './mini-player';
export function useListeningDockInset() {
  const listening = useHasListeningTrack();
  const visit = !!activeVisit(useVenue());
  return (listening ? MINI_PLAYER_HEIGHT : 0) + (visit ? 44 : 0) + (visit || listening ? 24 : 0);
}
