import { Button, Host, VStack } from '@expo/ui/swift-ui';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Alert, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAccount } from '@/lib/account/use-account';

export function AccountSection() {
  const { account, available, busy, error, ready, signInWithApple, signOut, deleteAccount } = useAccount();
  return (
    <View style={styles.section}>
      {account?.linked ? <>
        <ThemedText>Signed in · {account.deviceCount} {account.deviceCount === 1 ? 'device' : 'devices'}</ThemedText>
        {account.email && <ThemedText>{account.email}</ThemedText>}
        <ThemedText themeColor="textSecondary">Photos stay on the phone that took them.</ThemedText>
        {!busy && <Host matchContents colorScheme="light">
          <VStack alignment="leading" spacing={Spacing.two}>
            <Button label="Sign out" onPress={() => { void signOut(); }} />
            <Button label="Delete account" role="destructive" onPress={() => Alert.alert(
              'Delete account?', 'This disconnects all your devices. Saved works stay on each phone.',
              [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete account', style: 'destructive', onPress: () => { void deleteAccount(); } }],
            )} />
          </VStack>
        </Host>}
      </> : <>
        <ThemedText themeColor="textSecondary">Sign in with Apple to sync across devices. Your saved works and photos stay on this phone when you sign out.</ThemedText>
        {available && ready && !busy && <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={8} style={styles.appleButton} onPress={() => { void signInWithApple(); }}
        />}
      </>}
      {busy && <ThemedText themeColor="textSecondary">Updating account…</ThemedText>}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
    </View>
  );
}

const styles = StyleSheet.create({ section: { gap: Spacing.two }, appleButton: { height: 44, width: 230 } });
