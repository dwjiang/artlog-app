import { Button, Host } from '@expo/ui';
import { useMutation } from 'convex/react';
import { useRef, useState } from 'react';

import { api } from '../../../convex/_generated/api';

import { ThemedText } from '@/components/themed-text';
import { getAppAttest } from '@/lib/app-attest';
import { signPayload } from '@/lib/attested-write';

export function DevTools({ attested }: { attested: boolean }) {
  const assertSmoke = useMutation(api.devices.assertSmoke);
  const [result, setResult] = useState<string>();
  const [running, setRunning] = useState(false);
  const inFlight = useRef(false);
  const supported = getAppAttest() !== null;

  async function checkAssertion() {
    if (inFlight.current) return;
    inFlight.current = true;
    setRunning(true);
    setResult(undefined);
    try {
      const signed = await signPayload({ action: 'assertSmoke' });
      if (!signed) {
        setResult('App Attest is unsupported on this device.');
        return;
      }
      const first = await assertSmoke(signed);
      const replay = await assertSmoke(signed);
      setResult(`Assertion: ${first.ok ? 'accepted' : 'rejected'} · Replay: ${replay.ok ? 'accepted' : 'rejected'}`);
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error));
    } finally {
      inFlight.current = false;
      setRunning(false);
    }
  }

  return (
    <>
      <ThemedText themeColor="textSecondary">
        {supported ? 'App Attest: supported' : 'App Attest: unsupported on this device'}
      </ThemedText>
      <Host matchContents colorScheme="light">
        <Button
          label={running ? 'Checking assertion…' : 'Check App Attest'}
          disabled={!supported || !attested || running}
          onPress={() => { void checkAssertion(); }}
        />
      </Host>
      {result && <ThemedText themeColor="textSecondary">{result}</ThemedText>}
    </>
  );
}
