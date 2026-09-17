import { Switch, Text } from '@expo/ui';
import { Section } from '@expo/ui/swift-ui';
import { useMutation } from 'convex/react';
import { useEffect, useRef, useState } from 'react';

import { api } from '../../../convex/_generated/api';

import { ActionRow } from '@/components/grouped-list';
import { Gallery } from '@/constants/theme';
import { getAppAttest } from '@/lib/app-attest';
import { signPayload } from '@/lib/attested-write';
import { embedder } from '@/lib/embed/embedder';
import { runCalibrationExport } from '@/lib/embed/run-calibration-export';
import { runOrbParityCheck } from '@/lib/orb/run-parity-check';
import { useDevTimings } from '@/lib/settings/use-dev-timings';

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function Status({ children }: { children: string }) {
  return <Text textStyle={{ fontSize: 13, color: Gallery.muted }}>{children}</Text>;
}

export function DevTools({ attested }: { attested: boolean }) {
  const timings = useDevTimings();
  const [savingTimings, setSavingTimings] = useState(false);
  const assertSmoke = useMutation(api.devices.assertSmoke);
  const [result, setResult] = useState<string>();
  const [running, setRunning] = useState(false);
  const inFlight = useRef(false);
  const supported = getAppAttest() !== null;
  const [modelStatus, setModelStatus] = useState('Embedding model: loading…');
  const [calibration, setCalibration] = useState<string>();
  const [progress, setProgress] = useState<string>();
  const exporting = useRef(false);
  const [orbParity, setOrbParity] = useState<string>();
  const [checkingOrb, setCheckingOrb] = useState(false);
  const orbInFlight = useRef(false);

  useEffect(() => {
    let active = true;
    embedder.warmUp().then(
      (warm) => {
        if (active) setModelStatus(`Embedding model: ready · load ${Math.round(warm.loadMs)} ms · predict ${Math.round(warm.predictMs)} ms`);
      },
      (error: unknown) => {
        if (active) setModelStatus(`Embedding model: ${message(error)}`);
      },
    );
    return () => { active = false; };
  }, []);

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
      setResult(message(error));
    } finally {
      inFlight.current = false;
      setRunning(false);
    }
  }

  async function exportCalibration() {
    if (exporting.current) return;
    exporting.current = true;
    setCalibration(undefined);
    setProgress('Exporting calibration…');
    try {
      const { report } = await runCalibrationExport((done, total) => setProgress(`Exporting calibration ${done}/${total}…`));
      setCalibration(`Calibration: ${report.count} embeddings · median ${report.embedMedianMs.toFixed(1)} ms · ${report.device}`);
    } catch (error) {
      setCalibration(message(error));
    } finally {
      exporting.current = false;
      setProgress(undefined);
    }
  }

  async function checkOrbParity() {
    if (orbInFlight.current) return;
    orbInFlight.current = true;
    setCheckingOrb(true);
    setOrbParity(undefined);
    try {
      const report = await runOrbParityCheck();
      setOrbParity(
        `ORB: ${report.count}/${report.expectedCount} keypoints · ${report.rowsAnywhere} rows match (${report.rowsInOrder} in order)` +
        ` · extract ${report.extractMs.toFixed(1)} ms · blur ${Math.round(report.blurVariance)} · glare ${(report.glareFraction * 100).toFixed(1)}%` +
        ` · triage ${report.triageMs.toFixed(1)} ms · ${report.device}`,
      );
    } catch (error) {
      setOrbParity(message(error));
    } finally {
      orbInFlight.current = false;
      setCheckingOrb(false);
    }
  }

  return <>
    <Section title="Capture">
      <Switch label="Show capture timings" value={timings.enabled === true} disabled={timings.enabled === undefined || savingTimings}
        onValueChange={(value) => {
          setSavingTimings(true);
          void timings.change(value).catch(() => setResult("Couldn't save the timings setting. Try again.")).finally(() => setSavingTimings(false));
        }} />
    </Section>
    <Section title="App Attest">
      <Status>{supported ? 'App Attest: supported' : 'App Attest: unsupported on this device'}</Status>
      <ActionRow label={running ? 'Checking assertion…' : 'Check App Attest'} disabled={!supported || !attested || running} onPress={() => { void checkAssertion(); }} />
      {result ? <Status>{result}</Status> : null}
    </Section>
    <Section title="Embedding">
      <Status>{modelStatus}</Status>
      <ActionRow label={progress ?? 'Export calibration embeddings'} disabled={progress !== undefined} onPress={() => { void exportCalibration(); }} />
      {calibration ? <Status>{calibration}</Status> : null}
      <ActionRow label={checkingOrb ? 'Checking ORB parity…' : 'Check ORB parity'} disabled={checkingOrb} onPress={() => { void checkOrbParity(); }} />
      {orbParity ? <Status>{orbParity}</Status> : null}
    </Section>
  </>;
}
