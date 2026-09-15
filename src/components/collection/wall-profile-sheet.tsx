import { Column, Host, TextInput, Text as NativeText } from '@expo/ui';
import { useMutation } from 'convex/react';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { api } from '../../../convex/_generated/api';
import { Gallery } from '@/constants/theme';
import { captureOwner } from '@/lib/account/owner-store';
import { socialErrorMessage } from '@/shared/social/errors';
import { LIMITS } from '@/shared/journal/limits';
import { GalleryButton } from './gallery-button';
import { WallSheet, wallSheetStyles as styles } from './wall-sheets';

export function WallProfileSheet({ onDismiss, onCreated }: { onDismiss: () => void; onCreated: () => void }) {
  return <WallSheet title="Your public wall" onDismiss={onDismiss} tall><ProfileForm onCreated={onCreated} /></WallSheet>;
}

export function ProfileForm({ onCreated, forVisits = false }: { onCreated: () => void; forVisits?: boolean }) {
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

  return <ScrollView contentInsetAdjustmentBehavior="automatic" automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.section, { gap: 20 }]}>
      <Text style={styles.body}>{forVisits ? 'Create a profile so friends can recognize you. You will review this visit before sharing it.' : 'Give your wall a name. Choose which artworks to hang after creating your profile.'}</Text>
      <Host matchContents={{ vertical: true }} colorScheme="light" seedColor={Gallery.accent}>
        <Column spacing={20}>
          <Column spacing={8} alignment="start">
            <NativeText textStyle={{ fontSize: 12, fontWeight: '500', color: Gallery.ink }}>Name</NativeText>
            <TextInput placeholder="Your name" onChangeText={setName} autoCapitalize="words" maxLength={LIMITS.name}
              style={formStyles.input} textStyle={{ fontSize: 14, color: Gallery.ink }} />
          </Column>
          <Column spacing={8} alignment="start">
            <NativeText textStyle={{ fontSize: 12, fontWeight: '500', color: Gallery.ink }}>Username</NativeText>
            <TextInput placeholder="Username" onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} maxLength={LIMITS.usernameMax}
              style={formStyles.input} textStyle={{ fontSize: 14, color: Gallery.ink }} />
          </Column>
        </Column>
      </Host>
      <Text style={styles.caption}>Your name, username, and wall are public. Visits and private notes are separate.</Text>
      {error && <Text accessibilityRole="alert" selectable style={styles.body}>{error}</Text>}
      <GalleryButton label={busy ? 'Creating…' : 'Create public profile'} variant="filled" fullWidth disabled={busy || !name.trim() || !username.trim()}
        onPress={() => { void submit(); }} />
    </ScrollView>;
}

const formStyles = StyleSheet.create({
  input: { padding: 12, backgroundColor: Gallery.surface, borderRadius: 9, borderWidth: 0.5, borderColor: Gallery.separator },
});
