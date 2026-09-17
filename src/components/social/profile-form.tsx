import { Text, TextInput } from '@expo/ui';
import { Section } from '@expo/ui/swift-ui';
import { accessibilityLabel, listRowBackground } from '@expo/ui/swift-ui/modifiers';
import { useMutation } from 'convex/react';
import { useState } from 'react';
import { api } from '../../../convex/_generated/api';
import { ActionRow, GroupedFooter, GroupedList } from '@/components/grouped-list';
import { Gallery } from '@/constants/theme';
import { captureOwner } from '@/lib/account/owner-store';
import { socialErrorMessage } from '@/shared/social/errors';
import { LIMITS } from '@/shared/journal/limits';

export function ProfileForm({ onCreated, introduction }: { onCreated: () => void; introduction: string }) {
  const create = useMutation(api.profiles.create);
  const [name, setName] = useState(''), [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>();

  async function submit() {
    if (busy) return;
    const session = captureOwner();
    setBusy(true); setError(undefined);
    try {
      await create({ name: name.trim(), username: username.trim().toLowerCase() });
      if (session.isCurrent()) onCreated();
    } catch (cause) {
      if (session.isCurrent()) setError(socialErrorMessage(cause) ?? 'Your profile could not be created. Try again.');
    } finally { if (session.isCurrent()) setBusy(false); }
  }

  return <GroupedList>
    <Section><Text textStyle={{ fontSize: 15, color: Gallery.ink }} modifiers={[listRowBackground('transparent')]}>{introduction}</Text></Section>
    <Section footer={<GroupedFooter tone={error ? 'destructive' : 'muted'}>{error ?? 'Your name, username, and wall are public. Visits and private notes are separate.'}</GroupedFooter>}>
      <TextInput placeholder="Your name" onChangeText={setName} autoCapitalize="words" maxLength={LIMITS.name} editable={!busy} modifiers={[accessibilityLabel('Name')]} />
      <TextInput placeholder="Username" onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} maxLength={LIMITS.usernameMax} editable={!busy} modifiers={[accessibilityLabel('Username')]} />
    </Section>
    <Section>
      <ActionRow label={busy ? 'Creating…' : 'Create public profile'} disabled={busy || !name.trim() || !username.trim()} onPress={() => { void submit(); }} />
    </Section>
  </GroupedList>;
}
