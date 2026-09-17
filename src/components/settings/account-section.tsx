import { Button, Host, VStack } from '@expo/ui/swift-ui';
import { router } from 'expo-router';
import { Alert, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Gallery, Spacing } from '@/constants/theme';
import { useAccount } from '@/lib/account/use-account';
import { signInRoute } from '@/lib/account/sign-in-context';
import { GalleryButton } from '../collection/gallery-button';

export function AccountSection() {
  const { account, busy, error, signOut, deleteAccount } = useAccount();
  return (
    <View style={styles.section}>
      {account?.linked ? <>
        <ThemedText>Signed in · {account.deviceCount} {account.deviceCount === 1 ? 'device' : 'devices'}</ThemedText>
        {account.email && <ThemedText>{account.email}</ThemedText>}
        <ThemedText themeColor="textSecondary">Saved works and photos sync privately across your devices. Downloaded photos are available offline.</ThemedText>
        {!busy && <Host matchContents colorScheme="light" seedColor={Gallery.accent}>
          <VStack alignment="leading" spacing={Spacing.two}>
            <Button label="Sign out" onPress={() => { void signOut(); }} />
            <Button label="Delete account" role="destructive" onPress={() => Alert.alert(
              'Delete account?', 'This disconnects all your devices. Saved works stay on each phone.',
              [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete account', style: 'destructive', onPress: () => { void deleteAccount(); } }],
            )} />
          </VStack>
        </Host>}
      </> : <>
        <GalleryButton label="Sign in to Artlog" onPress={() => router.push(signInRoute('account'))} />
      </>}
      {busy && <ThemedText themeColor="textSecondary">Updating account…</ThemedText>}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
    </View>
  );
}

const styles = StyleSheet.create({ section: { gap: Spacing.two } });
