import { useRef, useState, type ReactNode } from "react";
import { type AccessibilityActionEvent, Pressable, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import Sortable from "react-native-sortables";

import { GalleryButton } from "@/components/collection/gallery-button";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import { trackKey, type ListeningTrack } from "@/lib/audio/narration";
import { useListening } from "@/lib/audio/use-listening";

import { ArtworkThumbnail } from "./artwork-thumbnail";
import { AudioIcon } from "./audio-icon";

export function ListeningQueue({ onAdd }: { onAdd: () => void }) {
  const audio = useListening();
  if (!audio.current) return null;
  // A new work remounts the list so it opens on that work again, with history above and out of view.
  return <QueueList key={trackKey(audio.current)} current={audio.current} onAdd={onAdd} />;
}

function QueueList({ current, onAdd }: { current: ListeningTrack; onAdd: () => void }) {
  const audio = useListening();
  const scroll = useAnimatedRef<Animated.ScrollView>();
  // React Native still delivers a press after a row is swiped or dragged; that row's touch must not play it.
  const unplayable = useRef<string>(undefined);
  const blockPress = (key?: string) => {
    unplayable.current = key;
  };
  const hasHistory = audio.history.length > 0;
  const [anchored, setAnchored] = useState(!hasHistory);
  const [space, setSpace] = useState({ viewport: 0, history: 0 });
  const measured = useRef({ ...space, content: 0 });
  // Layout and content size arrive in any order; scroll past history once the list is tall enough to hold it.
  function measure(patch: Partial<typeof measured.current>) {
    const next = { ...measured.current, ...patch };
    measured.current = next;
    if (patch.content === undefined) setSpace({ viewport: next.viewport, history: next.history });
    if (anchored || !next.history || !next.viewport || next.content + 1 < next.history + next.viewport) return;
    scroll.current?.scrollTo({ y: next.history, animated: false });
    setAnchored(true);
  }
  return (
    <GestureHandlerRootView style={styles.root}>
      <Animated.ScrollView
        ref={scroll}
        onLayout={(event) => measure({ viewport: event.nativeEvent.layout.height })}
        onContentSizeChange={(_, content) => measure({ content })}
        // Room below the playing work lets it sit at the top even when little is queued.
        contentContainerStyle={{ minHeight: (hasHistory ? space.history : 0) + space.viewport }}
        style={{ opacity: anchored ? 1 : 0 }}
      >
        {hasHistory && (
          <View onLayout={(event) => measure({ history: event.nativeEvent.layout.height })}>
            <Heading title="History">
              <GalleryButton label="Clear" onPress={audio.controller.clearHistory} />
            </Heading>
            {audio.history.map((track, index) => (
              <TrackRow
                key={trackKey(track)}
                track={track}
                last={index === audio.history.length - 1}
                onPress={() => void audio.controller.play(track)}
              />
            ))}
          </View>
        )}
        <View accessible style={styles.current}>
          <ArtworkThumbnail uri={current.work.imageUri} size={56} />
          <View style={styles.text}>
            <Text style={styles.currentTitle}>{current.work.title}</Text>
            <Text variant="secondary" themeColor="textSecondary">
              {current.work.artist}
            </Text>
          </View>
        </View>
        <Heading title="Up next">
          {audio.queue.length > 0 && (
            <GalleryButton label="Add" accessibilityLabel="Add saved works" icon="plus" onPress={onAdd} />
          )}
        </Heading>
        {audio.queue.length === 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={onAdd}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.addTile}>
              <AudioIcon name="plus" size={20} color={Gallery.accent} />
            </View>
            <Text variant="button" style={{ color: Gallery.accent }}>
              Add saved works
            </Text>
          </Pressable>
        ) : (
          <Sortable.Grid
            data={audio.queue}
            keyExtractor={trackKey}
            scrollableRef={scroll}
            hapticsEnabled
            onDragStart={({ key }) => blockPress(key)}
            onDragEnd={({ fromIndex, toIndex }) => audio.controller.move(fromIndex, toIndex)}
            renderItem={({ item, index }) => (
              <QueuedRow
                track={item}
                index={index}
                count={audio.queue.length}
                blockPress={blockPress}
                pressBlocked={(key) => unplayable.current === key}
              />
            )}
          />
        )}
      </Animated.ScrollView>
    </GestureHandlerRootView>
  );
}

function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={styles.heading}>
      <Text variant="section" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

function QueuedRow({
  track,
  index,
  count,
  blockPress,
  pressBlocked,
}: {
  track: ListeningTrack;
  index: number;
  count: number;
  blockPress: (key?: string) => void;
  pressBlocked: (key: string) => boolean;
}) {
  const audio = useListening();
  const key = trackKey(track);
  const open = useRef(false);
  const remove = () => audio.controller.remove(key);
  function act({ nativeEvent }: AccessibilityActionEvent) {
    if (nativeEvent.actionName === "remove") remove();
    else audio.controller.move(index, index + (nativeEvent.actionName === "earlier" ? -1 : 1));
  }
  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      onSwipeableOpenStartDrag={() => blockPress(key)}
      onSwipeableCloseStartDrag={() => blockPress(key)}
      onSwipeableWillOpen={() => (open.current = true)}
      onSwipeableClose={() => (open.current = false)}
      renderRightActions={() => (
        // VoiceOver reaches Remove through the row's actions instead of this hidden button.
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={remove}
          style={styles.remove}
        >
          <AudioIcon name="trash" size={18} color={Gallery.surface} />
          <Text variant="metadata" style={styles.removeText}>
            Remove
          </Text>
        </Pressable>
      )}
    >
      <TrackRow
        track={track}
        last={index === count - 1}
        reorderable
        // A tap on an open row only closes it.
        onPressIn={() => blockPress(open.current ? key : undefined)}
        onPress={() => {
          if (!pressBlocked(key)) void audio.controller.play(track);
        }}
        accessibilityActions={[
          { name: "remove", label: "Remove" },
          ...(index > 0 ? [{ name: "earlier", label: "Move earlier" }] : []),
          ...(index < count - 1 ? [{ name: "later", label: "Move later" }] : []),
        ]}
        onAccessibilityAction={act}
      />
    </ReanimatedSwipeable>
  );
}

function TrackRow({
  track,
  last,
  reorderable = false,
  onPressIn,
  onPress,
  accessibilityActions,
  onAccessibilityAction,
}: {
  track: ListeningTrack;
  last: boolean;
  reorderable?: boolean;
  onPressIn?: () => void;
  onPress: () => void;
  accessibilityActions?: { name: string; label: string }[];
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Play ${track.work.title}, ${track.work.artist}`}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      onPressIn={onPressIn}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <ArtworkThumbnail uri={track.work.imageUri} size={44} />
      <View style={[styles.rowBody, !last && styles.separator]}>
        <View style={styles.text}>
          <Text numberOfLines={2} style={styles.rowTitle}>
            {track.work.title}
          </Text>
          <Text numberOfLines={1} style={styles.rowArtist}>
            {track.work.artist}
          </Text>
        </View>
        {reorderable && <AudioIcon name="line.3.horizontal" size={18} color={Gallery.muted} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  heading: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: Spacing.content,
    paddingRight: Spacing.two,
    marginTop: Spacing.compact,
  },
  current: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.compact,
    paddingHorizontal: Spacing.content,
    paddingVertical: Spacing.two,
  },
  currentTitle: { fontSize: 17, lineHeight: 22, fontWeight: "600" },
  text: { flex: 1, gap: Spacing.half },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.compact,
    paddingLeft: Spacing.content,
    backgroundColor: Gallery.paper,
  },
  pressed: { backgroundColor: Gallery.fill },
  rowBody: {
    flex: 1,
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.compact,
    paddingRight: Spacing.content,
  },
  separator: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Gallery.separator },
  rowTitle: { fontSize: 15, lineHeight: 20, fontWeight: "500" },
  rowArtist: { fontSize: 13, lineHeight: 18, color: Gallery.muted },
  addTile: {
    width: 44,
    height: 44,
    marginVertical: Spacing.two,
    borderRadius: Radius.thumbnail,
    backgroundColor: Gallery.highlight,
    alignItems: "center",
    justifyContent: "center",
  },
  remove: {
    width: 92,
    backgroundColor: Gallery.destructive,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.one,
  },
  removeText: { color: Gallery.surface, fontWeight: "600" },
});
