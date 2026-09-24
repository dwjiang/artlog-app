import { Host, Switch } from "@expo/ui";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import { DisplayMedia } from "@/components/artwork/display-media";
import { GalleryButton } from "@/components/collection/gallery-button";
import { EmptyState } from "@/components/empty-state";
import { EmptyPaper } from "@/components/empty-state-art";
import { LoadingRing } from "@/components/loading-ring";
import { NotePaper } from "@/components/note-paper";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { signInRoute } from "@/lib/account/sign-in-context";
import { reportError } from "@/lib/observability";
import { showToast } from "@/lib/ui/toast";
import { useCollectionWall } from "@/lib/wall/use-collection-wall";

import { PublicNotesPreview } from "./public-notes-preview";
import { SocialState } from "./social-state";
import { socialStyles } from "./social-styles";

const INTRO =
  "Choose which notes visitors can read alongside artworks on your wall. Editing a shared note makes it private until you share it again.";

export function PublicNotesScreen() {
  const wall = useCollectionWall([]);
  const [preview, setPreview] = useState(false);
  const changes = wall.noteDraft;
  const items = wall.acknowledged?.items ?? [];
  function visible(item: (typeof items)[number]) {
    return changes.find((change) => change.itemId === item.itemId)?.visible ?? item.noteVisible;
  }
  function toggle(item: (typeof items)[number], value: boolean) {
    wall.repository.setNoteDraft([
      ...changes.filter((change) => change.itemId !== item.itemId),
      { itemId: item.itemId, visible: value },
    ]);
    wall.setError(undefined);
  }
  async function save() {
    wall.setError(undefined);
    try {
      await wall.repository.publishNotes();
      setPreview(false);
      showToast("Your note choices are saved.");
    } catch (cause) {
      reportError(cause, "wall.notes.publish");
      wall.setError(
        wall.repository.getSnapshot().needsNoteConfirmation
          ? "A note changed. Review the latest notes and choose again."
          : "Your choices were not saved. Check your connection and try again.",
      );
    }
  }
  const gate = !wall.signedIn ? (
    <EmptyState
      title="Sign in to manage public notes."
      detail="Sign in to choose which artwork notes appear on your public wall."
      visual={<EmptyPaper kind="note" />}
      footnote="Your existing notes stay private."
    >
      <GalleryButton label="Sign in" variant="filled" fullWidth onPress={() => router.push(signInRoute("wall"))} />
    </EmptyState>
  ) : wall.profileRequired ? (
    <SocialState
      title="Create your public profile first."
      icon="person.crop.circle.badge.plus"
      action="Create your profile"
      onAction={() => router.push("/create-profile")}
    />
  ) : wall.loading || (!wall.acknowledged && !wall.error) ? (
    <SocialState title="Opening your notes…" loading />
  ) : null;
  if (gate) {
    return (
      <ScrollView
        style={socialStyles.root}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={wall.signedIn ? socialStyles.gate : { paddingVertical: 20 }}
      >
        {gate}
      </ScrollView>
    );
  }
  // Toolbar items must be direct children so the native header can extract them.
  const toolbar = (
    <Stack.Toolbar placement="right">
      {preview ? (
        <Stack.Toolbar.Button tintColor={Gallery.ink} onPress={() => setPreview(false)}>
          Edit
        </Stack.Toolbar.Button>
      ) : (
        <Stack.Toolbar.Button tintColor={Gallery.ink} onPress={() => setPreview(true)}>
          Preview
        </Stack.Toolbar.Button>
      )}
      {!preview
        && (wall.pending ? (
          <Stack.Toolbar.View>
            <LoadingRing accessibilityLabel="Saving note choices…" style={{ width: 44, height: 44 }} />
          </Stack.Toolbar.View>
        ) : (
          <Stack.Toolbar.Button
            variant="done"
            tintColor={Gallery.ink}
            disabled={changes.length === 0}
            onPress={() => {
              void save();
            }}
          >
            Save
          </Stack.Toolbar.Button>
        ))}
    </Stack.Toolbar>
  );
  if (preview && wall.acknowledged) {
    return (
      <>
        {toolbar}
        <ScrollView
          style={socialStyles.root}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingVertical: 20 }}
        >
          <PublicNotesPreview
            wall={{
              profileId: wall.acknowledged.profileId,
              color: wall.acknowledged.color,
              artworkCount: new Set(items.map((item) => item.saveLocalId)).size,
              items: items.map((item) => ({
                itemId: item.itemId,
                layout: item.layout,
                artwork: item.artwork,
                ...(visible(item) && item.privateNote ? { note: item.privateNote } : {}),
              })),
            }}
          />
        </ScrollView>
      </>
    );
  }
  const eligible = items.filter((item) => item.noteEligible || item.noteVisible);
  if (eligible.length === 0 && !wall.error) {
    return (
      <ScrollView style={socialStyles.root} contentInsetAdjustmentBehavior="automatic">
        <EmptyState
          title="No notes to share yet."
          detail="Add a private note to an artwork on your wall. After it syncs, you can choose whether to show it here."
          visual={<EmptyPaper kind="note" />}
          footnote="Notes stay private unless you choose to share them."
        >
          <GalleryButton
            label="Go to your wall"
            variant="filled"
            fullWidth
            onPress={() => {
              router.dismissAll();
              router.navigate({
                pathname: "/collection",
                params: { view: "wall" },
              });
            }}
          />
        </EmptyState>
      </ScrollView>
    );
  }
  return (
    <>
      {toolbar}
      <ScrollView
        style={socialStyles.root}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, gap: 22 }}
      >
        <Text themeColor="textSecondary">{INTRO}</Text>
        {wall.error && (
          <>
            <Text themeColor="error" accessibilityRole="alert">
              {wall.error}
            </Text>
            <GalleryButton
              label="Refresh notes"
              onPress={() => {
                void wall.refresh();
              }}
            />
          </>
        )}
        {eligible.map((item) => (
          <View
            key={item.itemId}
            style={{
              gap: 12,
              paddingBottom: 16,
              borderBottomWidth: 0.5,
              borderBottomColor: Gallery.separator,
            }}
          >
            <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
              <DisplayMedia media={item.artwork.media} label={item.artwork.title} width={48} height={56} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: "600" }}>{item.artwork.title}</Text>
                <Text type="small" themeColor="textSecondary">
                  {item.artwork.artist}
                </Text>
              </View>
            </View>
            {item.privateNote && (
              <NotePaper>
                <Text>{item.privateNote}</Text>
              </NotePaper>
            )}
            <Host matchContents={{ vertical: true }} colorScheme="light" style={{ width: "100%" }}>
              <Switch
                label="Show note on public wall"
                value={visible(item)}
                disabled={wall.pending || (!item.noteEligible && !item.noteVisible)}
                onValueChange={(value) => toggle(item, value)}
              />
            </Host>
          </View>
        ))}
        <Text type="small" themeColor="textSecondary">
          Your notes stay private until you turn them on and save your choices.
        </Text>
      </ScrollView>
    </>
  );
}
