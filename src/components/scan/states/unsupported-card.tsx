import { StyleSheet, View } from "react-native";

import { AppUpdateButton } from "@/components/app-update-button";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";

import { SaveAnywayForm, type SaveAnywayFormProps } from "./save-anyway-form";

// Product voice: an older client's scans wait for the update, which re-embeds the kept crop locally.
export const UPDATE_TITLE = "Update required.";
export const UPDATE_LINE =
  "Update Artlog to identify this artwork. Your photo is saved on this iPhone and will be ready when you return.";
export const UPDATE_BUTTON = "Update the app";

export function UnsupportedCard(save: SaveAnywayFormProps) {
  return (
    <>
      <View style={styles.section}>
        <ThemedText type="title">{UPDATE_TITLE}</ThemedText>
        <ThemedText themeColor="textSecondary">{UPDATE_LINE}</ThemedText>
      </View>
      <AppUpdateButton label={UPDATE_BUTTON} />
      <SaveAnywayForm {...save} compact />
    </>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
});
