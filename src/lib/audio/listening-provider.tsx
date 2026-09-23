import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useAction } from 'convex/react';
import { useEffect, useMemo, type ReactNode } from 'react';
import { api } from '../../../convex/_generated/api';
import { useLocalOwner } from '@/lib/account/owner-store';
import { ListeningController } from './listening-controller';
import { createNarrationRenderer } from './narration-renderer';
import { ListeningContext } from './use-listening';

export function ListeningProvider({ children }: { children: ReactNode }) {
  const owner = useLocalOwner();
  const generate = useAction(api.narration.render);
  const session = useMemo(() => ({ owner, controller: new ListeningController({
    ...createNarrationRenderer(generate),
    create: (uri) => createAudioPlayer(uri, { updateInterval: 250 }),
    configure: () => setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }),
  }) }), [owner, generate]);
  useEffect(() => () => session.controller.dispose(), [session]);
  return <ListeningContext value={session.controller}>{children}</ListeningContext>;
}
