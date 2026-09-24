import { LoadingRing } from "@/components/loading-ring";
import { useEffect, type PropsWithChildren } from "react";
import { StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Gallery, Spacing } from "@/constants/theme";
import { useDatabaseMigrations } from "@/db/use-database-migrations";
import { addBreadcrumb, reportError } from "@/lib/observability";

/** Holds the app until the local store is migrated; nothing below it touches the database earlier. */
export function DatabaseGate({ children }: PropsWithChildren) {
  const { success, error } = useDatabaseMigrations();
  useEffect(() => {
    if (error) reportError(error, "database.initialize");
    else if (success) addBreadcrumb("database.ready");
  }, [error, success]);
  if (error) {
    return (
      <ThemedView style={styles.gate}>
        <ThemedText type="subtitle">Could not open the local database</ThemedText>
        <ThemedText>
          Your collection could not be opened. Close Artlog and try opening it again. Your saved data has not been
          reset.
        </ThemedText>
        <ThemedText themeColor="textSecondary" selectable>
          {error.message}
        </ThemedText>
      </ThemedView>
    );
  }
  if (!success) {
    return (
      <ThemedView style={styles.gate}>
        <LoadingRing accessibilityLabel="Opening your collection" color={Gallery.accent} />
      </ThemedView>
    );
  }
  return children;
}

const styles = StyleSheet.create({
  gate: {
    flex: 1,
    justifyContent: "center",
    padding: Spacing.four,
    gap: Spacing.two,
  },
});
