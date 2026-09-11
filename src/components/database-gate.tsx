import type { PropsWithChildren } from 'react';
import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useDatabaseMigrations } from '@/db/migrations';

/** Holds the app until the local store is migrated; nothing below it touches the database earlier. */
export function DatabaseGate({ children }: PropsWithChildren) {
  const { success, error } = useDatabaseMigrations();
  if (error) {
    return (
      <ThemedView style={styles.gate}>
        <ThemedText type="subtitle">Could not open the local database</ThemedText>
        <ThemedText themeColor="textSecondary" selectable>{error.message}</ThemedText>
      </ThemedView>
    );
  }
  if (!success) return <ThemedView style={styles.gate} />;
  return children;
}

const styles = StyleSheet.create({
  gate: { flex: 1, justifyContent: 'center', padding: Spacing.four, gap: Spacing.two },
});
