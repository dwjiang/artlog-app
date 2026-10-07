import { Button, Host } from "@expo/ui/swift-ui";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { Image } from "expo-image";
import { useState } from "react";
import { ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from "react-native";

import { ParagraphSkeleton } from "@/components/loading-skeleton";
import { NotePaper } from "@/components/note-paper";
import { useRichTextInput } from "@/components/social/rich-text-input";
import { TaggedText } from "@/components/social/tagged-text";
import { ThemedText } from "@/components/themed-text";
import { Colors, Fonts, Gallery, Spacing } from "@/constants/theme";
import { selectSavedWork } from "@/db/repos/saved-works";
import { useArtworkNote } from "@/hooks/use-artwork-note";
import { useLocalOwner } from "@/lib/account/owner-store";
import { MAX_NOTE_LENGTH, NOTE_LENGTH_MESSAGE } from "@/shared/collection/collection-limits";

import { GalleryButton } from "./gallery-button";
import { SavedWorkImage } from "./saved-work-image";
import { WallSheet } from "./wall-sheet";

export function NoteHeading({ title, children }: { title: string; children?: React.ReactNode }) {
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= 1.5;
  return (
    <View style={[styles.heading, stacked && { flexDirection: "column", alignItems: "stretch" }]}>
      <ThemedText accessibilityRole="header" style={[styles.title, stacked && { flex: 0 }]}>
        {title}
      </ThemedText>
      {children}
    </View>
  );
}

// Saves on blur and when the screen closes mid-edit.
export function NoteEditor({
  savedLocalId,
  initiallyEditing = false,
}: {
  savedLocalId: string;
  initiallyEditing?: boolean;
}) {
  const owner = useLocalOwner();
  return (
    <WorkNoteEditor
      key={`${owner}:${savedLocalId}:${initiallyEditing}`}
      savedLocalId={savedLocalId}
      owner={owner}
      initiallyEditing={initiallyEditing}
    />
  );
}

function WorkNoteEditor({
  savedLocalId,
  owner,
  initiallyEditing,
}: {
  savedLocalId: string;
  owner: string;
  initiallyEditing: boolean;
}) {
  const work = useLiveQuery(selectSavedWork(savedLocalId, owner), [savedLocalId, owner]).data[0];
  const { draft, savedText, saveFailed, loadFailed, setDraft, save } = useArtworkNote(savedLocalId, owner);
  const [editing, setEditing] = useState(initiallyEditing);
  const tagging = useRichTextInput({
    text: draft ?? "",
    onChangeText: setDraft,
    maxLength: MAX_NOTE_LENGTH,
    editable: draft !== undefined,
    place: { kind: "profile" },
    docked: true,
  });

  return (
    <View style={styles.section}>
      <NoteHeading title="Notes">
        {editing ? (
          <GalleryButton
            label="Done"
            accessibilityLabel="Done editing note"
            onPress={() => {
              void save();
              setEditing(false);
            }}
          />
        ) : (
          <GalleryButton
            label={draft ? "Edit" : "Add"}
            accessibilityLabel={draft ? "Edit note" : "Add note"}
            disabled={draft === undefined}
            onPress={() => setEditing(true)}
          />
        )}
      </NoteHeading>
      {loadFailed ? (
        <ThemedText accessibilityRole="alert" themeColor="error">
          Your note could not load. Reopen this artwork to try again.
        </ThemedText>
      ) : draft === undefined ? (
        <ParagraphSkeleton label="Loading your note…" />
      ) : null}
      {editing && draft !== undefined && (
        <WallSheet
          title="Notes"
          size="large"
          onDismiss={() => {
            void save();
            setEditing(false);
          }}
        >
          <ScrollView
            automaticallyAdjustKeyboardInsets
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 24, gap: 16 }}
          >
            <View
              style={{
                flexDirection: "row",
                gap: 12,
                alignItems: "center",
                paddingBottom: 18,
                borderBottomWidth: 0.5,
                borderBottomColor: Gallery.separator,
              }}
            >
              <SavedWorkImage
                path={work?.cropPath ?? null}
                title={work?.title ?? "Artwork"}
                contain
                style={{ width: 44, height: 52 }}
              />
              <View style={{ flex: 1, gap: 3 }}>
                <ThemedText variant="secondary" style={{ fontWeight: "600" }}>
                  {work?.title}
                </ThemedText>
                <ThemedText variant="metadata" themeColor="textSecondary">
                  {work?.artist}
                </ThemedText>
              </View>
            </View>
            <ThemedText variant="metadata" themeColor="textSecondary" style={{ letterSpacing: 1 }}>
              Private note
            </ThemedText>
            <TextInput
              autoFocus
              accessibilityLabel="Notes"
              placeholder="Add a note…"
              placeholderTextColor={Colors.light.textSecondary}
              multiline
              {...tagging.inputProps}
              onBlur={() => void save()}
              style={styles.input}
            />
            {tagging.suggestions}
            {draft?.length === MAX_NOTE_LENGTH && (
              <ThemedText themeColor="textSecondary" style={styles.body}>
                {NOTE_LENGTH_MESSAGE}
              </ThemedText>
            )}
            <ThemedText themeColor="textSecondary">
              {saveFailed
                ? "Couldn’t save. Your draft is still here."
                : draft === savedText
                  ? "Saved on this iPhone"
                  : "Saves when you close"}
            </ThemedText>
            {saveFailed && <GalleryButton label="Retry save" onPress={() => void save()} />}
          </ScrollView>
        </WallSheet>
      )}
      {draft !== undefined && (
        <NotePaper label="Private note">
          {draft ? (
            <TaggedText selectable style={styles.body}>
              {draft}
            </TaggedText>
          ) : (
            <ThemedText themeColor="textSecondary" style={styles.body}>
              No note yet.
            </ThemedText>
          )}
        </NotePaper>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Image source="sf:lock" tintColor={Gallery.muted} style={{ width: 13, height: 13 }} accessible={false} />
        <ThemedText style={{ color: Gallery.muted, fontSize: 13, lineHeight: 18 }}>Only you</ThemedText>
      </View>
      {saveFailed && !editing ? (
        <View>
          <ThemedText themeColor="textSecondary">Your note couldn’t be saved. Try again.</ThemedText>
          <Host matchContents colorScheme="light">
            <Button label="Retry save" onPress={() => void save()} />
          </Host>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 22,
    color: Gallery.ink,
  },
  body: { fontSize: 16, lineHeight: 24 },
  input: {
    minHeight: 110,
    padding: Spacing.three,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: Gallery.softBorder,
    backgroundColor: Gallery.surface,
    color: Colors.light.text,
    fontFamily: Fonts.sans,
    fontSize: 17,
    lineHeight: 24,
    textAlignVertical: "top",
  },
});
