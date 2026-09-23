import { Image } from "expo-image";
import * as Location from "expo-location";
import { useNetworkState } from "expo-network";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { MuseumSummary } from "@/shared/offline/types";
import { Gallery, Fonts } from "@/constants/theme";
import { ToastLayer } from "@/components/toast";
import { LoadingRing } from "@/components/loading-ring";
import { showToast } from "@/lib/ui/toast";
import { museumDownloads, previewUri } from "@/lib/museum-downloads/storage";
import { useMuseumDownloads } from "@/lib/museum-downloads/use-museum-downloads";
import {
  downloadProgress,
  formatDownloadSize,
  museumSortLabels,
  sortMuseums,
  type MuseumDownload,
  type MuseumSort,
} from "@/lib/museum-downloads/model";
import type { Coordinate } from "@/lib/venue/resolve";
import {
  DownloadButton,
  DownloadIcon,
  DownloadMenu,
  DownloadProgress,
  IconAction,
} from "./download-controls";

const hero = (museum: MuseumSummary) =>
  museum.key === "wikidata:Q239303"
    ? require("../../../assets/museums/art-institute.jpg")
    : undefined;
const errorText = (row: MuseumDownload) =>
  row.error === "space"
    ? "Not enough space. Remove a download and try again."
    : row.error === "connection"
      ? "Reconnect to resume."
      : row.error === "unavailable"
        ? "This museum is no longer available to download."
        : row.error
          ? "Download interrupted. Try again."
          : undefined;

export function MuseumDownloadsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const state = useMuseumDownloads();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<MuseumSort>("name");
  const [location, setLocation] = useState<Coordinate>();
  const [selected, setSelected] = useState<string>();
  const sortChosen = useRef(false);
  const list = useRef<FlatList<MuseumSummary>>(null);
  const scrollOffset = useRef(0);
  const all = new Map(state.catalog.map((m) => [m.id, m]));
  for (const row of Object.values(state.downloads))
    if (!all.has(row.museum.id)) all.set(row.museum.id, row.museum);
  const museums = sortMuseums([...all.values()], query, sort, location);
  const museum = selected ? all.get(selected as MuseumSummary["id"]) : undefined;
  useEffect(() => {
    let active = true;
    void (async () => {
      if (!(await Location.getForegroundPermissionsAsync()).granted) return;
      const fix = await Location.getLastKnownPositionAsync();
      if (active && fix) {
        setLocation({ lat: fix.coords.latitude, lng: fix.coords.longitude });
        if (!sortChosen.current) setSort("nearest");
      }
    })().catch(() => {});
    return () => {
      active = false;
      void museumDownloads.pauseAll().catch(() => {});
    };
  }, []);
  async function perform(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn’t finish. Try again.");
    }
  }
  function start(museum: MuseumSummary) {
    void perform(async () => {
      await museumDownloads.start(museum);
      const row = museumDownloads.getSnapshot().downloads[museum.id];
      if (row && errorText(row)) showToast(errorText(row)!);
    });
  }
  function remove(museum: MuseumSummary) {
    const size = state.downloads[museum.id]?.active?.manifest.size ?? museum.size;
    Alert.alert(
      `Remove ${museum.name}?`,
      `Free ${formatDownloadSize(size)}. Your saved artworks, notes, and photos will stay.`,
      [
        { text: "Keep download", style: "cancel" },
        {
          text: "Remove download",
          style: "destructive",
          onPress: () => {
            void perform(async () => {
              await museumDownloads.remove(museum.id);
              showToast("Download removed.");
            });
          },
        },
      ],
    );
  }
  function menu(museum: MuseumSummary, action: string) {
    if (action === "remove") remove(museum);
    if (action === "cancel") void perform(() => museumDownloads.cancel(museum.id));
    if (action === "update")
      void perform(async () => {
        if (!(await museumDownloads.checkForUpdate(museum)))
          showToast("This museum is up to date.");
        const row = museumDownloads.getSnapshot().downloads[museum.id];
        if (row && errorText(row)) showToast(errorText(row)!);
      });
  }
  const close = () => {
    void perform(async () => {
      await museumDownloads.pauseAll();
      router.back();
    });
  };
  return (
    <View
      style={[styles.screen, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 8) }]}
    >
      {museum ? (
        <MuseumDetail
          museum={museum}
          row={state.downloads[museum.id]}
          onBack={() => setSelected(undefined)}
          onStart={() => start(museum)}
          onPause={() => {
            void perform(() => museumDownloads.pause(museum.id));
          }}
          onCancel={() => {
            void perform(() => museumDownloads.cancel(museum.id));
          }}
        />
      ) : (
        <>
          <View style={styles.nav}>
            <IconAction label="Close museum downloads" icon="xmark" onPress={close} />
          </View>
          <FlatList
            ref={list}
            data={museums}
            keyExtractor={(museum) => museum.id}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onScroll={(event) => {
              scrollOffset.current = event.nativeEvent.contentOffset.y;
            }}
            onLayout={() => {
              if (scrollOffset.current)
                list.current?.scrollToOffset({ offset: scrollOffset.current, animated: false });
            }}
            contentInsetAdjustmentBehavior="never"
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 }}
            ListHeaderComponent={
              <>
                <Text
                  accessibilityRole="header"
                  style={[styles.title, fontScale > 1.4 && { fontSize: 28, lineHeight: 34 }]}
                >
                  Museum{"\n"}downloads
                </Text>
                <View style={styles.searchRow}>
                  <View style={styles.search}>
                    <DownloadIcon name="magnifyingglass" size={16} color={Gallery.muted} />
                    <TextInput
                      accessibilityLabel="Search museums"
                      placeholder="Museum or city"
                      placeholderTextColor={Gallery.muted}
                      value={query}
                      onChangeText={setQuery}
                      autoCorrect={false}
                      returnKeyType="search"
                      style={styles.searchInput}
                    />
                  </View>
                  <DownloadMenu
                    label={`Sort museums: ${museumSortLabels[sort]}`}
                    icon="arrow.up.arrow.down"
                    color={Gallery.accent}
                    actions={Object.entries(museumSortLabels).map(([id, title]) => ({
                      id,
                      title,
                      state: sort === id ? "on" : "off",
                      attributes: { disabled: id === "nearest" && !location },
                    }))}
                    onAction={(value) => {
                      sortChosen.current = true;
                      setSort(value as MuseumSort);
                    }}
                  />
                </View>
              </>
            }
            ListEmptyComponent={
              state.loading || !state.loaded ? (
                <LoadingRing accessibilityLabel="Loading museums" />
              ) : (
                <View style={{ paddingVertical: 24, gap: 12 }}>
                  <Text style={{ color: Gallery.muted }}>
                    {state.error ??
                      (query ? "No museums found." : "No museums available to download yet.")}
                  </Text>
                  {state.error && (
                    <DownloadButton
                      label="Try again"
                      secondary
                      onPress={() => {
                        void perform(museumDownloads.refresh);
                      }}
                    />
                  )}
                </View>
              )
            }
            renderItem={({ item }) => (
              <MuseumRow
                museum={item}
                row={state.downloads[item.id]}
                onOpen={() => setSelected(item.id)}
                onAction={() =>
                  state.downloads[item.id]?.status === "downloading"
                    ? void perform(() => museumDownloads.pause(item.id))
                    : start(item)
                }
                onMenu={(action) => menu(item, action)}
              />
            )}
          />
        </>
      )}
      <ToastLayer offset={0} />
    </View>
  );
}

export function MuseumRow({
  museum,
  row,
  onOpen,
  onAction,
  onMenu,
}: {
  museum: MuseumSummary;
  row?: MuseumDownload;
  onOpen: () => void;
  onAction: () => void;
  onMenu: (action: string) => void;
}) {
  const ready = row?.status === "ready",
    downloading = row?.status === "downloading",
    paused = row?.status === "paused";
  const progress = downloadProgress(row);
  const label = downloading ? "Pause" : paused ? "Resume" : "Download";
  return (
    <View style={styles.row}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View ${museum.name}`}
          onPress={onOpen}
          style={styles.rowOpen}
        >
          {hero(museum) ? (
            <Image source={hero(museum)} style={styles.thumb} contentFit="cover" />
          ) : (
            <View style={[styles.thumb, styles.placeholder]}>
              <DownloadIcon name="building.columns" size={25} color={Gallery.muted} />
            </View>
          )}
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.rowName}>{museum.name}</Text>
            <Text style={[styles.rowStatus, ready && { color: Gallery.success }]}>
              {ready
                ? "✓ Ready offline"
                : paused || downloading
                  ? `${paused ? "Paused" : "Downloading"} · ${progress}%`
                  : formatDownloadSize(museum.size)}
            </Text>
          </View>
        </Pressable>
        {!ready && (
          <IconAction
            label={`${label} ${museum.name}`}
            icon={downloading ? "pause" : paused ? "play" : "arrow.down.to.line"}
            color={Gallery.accent}
            onPress={onAction}
          />
        )}
        {row && (
          <DownloadMenu
            label={`Manage ${museum.name}`}
            icon="ellipsis"
            onAction={onMenu}
            actions={
              ready
                ? [
                    { id: "update", title: "Check for updates", image: "arrow.down.to.line" },
                    {
                      id: "remove",
                      title: "Remove download",
                      image: "trash",
                      attributes: { destructive: true },
                    },
                  ]
                : [
                    {
                      id: "cancel",
                      title: "Cancel download",
                      image: "xmark",
                      attributes: { destructive: true },
                    },
                  ]
            }
          />
        )}
      </View>
      {(paused || downloading) && (
        <View style={{ marginLeft: 59, paddingBottom: 8 }}>
          <DownloadProgress name={museum.name} progress={progress} />
        </View>
      )}
    </View>
  );
}

export function MuseumDetail({
  museum,
  row,
  onBack,
  onStart,
  onPause,
  onCancel,
}: {
  museum: MuseumSummary;
  row?: MuseumDownload;
  onBack: () => void;
  onStart: () => void;
  onPause: () => void;
  onCancel: () => void;
}) {
  const { height, fontScale } = useWindowDimensions();
  const network = useNetworkState();
  const offline = network.isConnected === false || network.isInternetReachable === false;
  const active = row?.status === "downloading",
    paused = row?.status === "paused",
    ready = row?.status === "ready";
  const progress = downloadProgress(row);
  const pack = row?.active ?? row?.pending;
  // Cached preview files are numbered by their own package, so a newer catalog entry must not relabel them.
  const previews = pack?.manifest.previews ?? museum.previews;
  return (
    <>
      <View style={styles.hero}>
        {hero(museum) ? (
          <Image
            source={hero(museum)}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            contentPosition="center"
          />
        ) : (
          <DownloadIcon name="building.columns" color={Gallery.muted} size={72} />
        )}
        <View style={styles.back}>
          <IconAction label="Back to museum downloads" icon="chevron.left" onPress={onBack} />
        </View>
      </View>
      <View style={[styles.sheet, { maxHeight: height - 180 }]}>
        <ScrollView
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ padding: 20, paddingBottom: 16 }}
          bounces={false}
        >
          <Text
            accessibilityRole="header"
            style={[styles.title, { marginBottom: 12, maxWidth: 290 }]}
          >
            {museum.name}
          </Text>
          {!active && !paused && !ready && (
            <Text style={styles.promise}>Scan and read offline.</Text>
          )}
          {!!previews.length && (
            <View
              style={{ flexDirection: fontScale > 1.4 ? "column" : "row", gap: 8, marginTop: 19 }}
            >
              {previews.map((preview, index) => (
                <Image
                  key={preview.url}
                  accessibilityLabel={preview.title}
                  accessible
                  source={previewUri(pack, index) ?? preview.url}
                  contentFit="cover"
                  style={{ flex: fontScale > 1.4 ? undefined : 1, aspectRatio: 1, borderRadius: 2 }}
                />
              ))}
            </View>
          )}
          {(active || paused) && (
            <View style={styles.progressSection}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                <Text style={styles.progressLabel}>
                  {paused ? "Download paused" : "Downloading"}
                </Text>
                <Text style={styles.percent}>{progress}%</Text>
              </View>
              <DownloadProgress name={museum.name} progress={progress} />
              {(errorText(row!) || (paused && offline)) && (
                <Text accessibilityRole="alert" style={styles.rowStatus}>
                  {errorText(row!) ?? "Reconnect to resume."}
                </Text>
              )}
            </View>
          )}
          {ready && (
            <View style={styles.ready}>
              <DownloadIcon name="checkmark" size={15} />
              <Text style={{ fontSize: 11, fontWeight: "600" }}>Ready offline</Text>
            </View>
          )}
        </ScrollView>
        <View
          style={[
            styles.footer,
            fontScale > 1.4 && { flexDirection: "column", alignItems: "stretch" },
          ]}
        >
          {active || paused ? (
            <>
              <DownloadButton
                label={paused ? "Resume download" : "Pause download"}
                icon={paused ? "arrow.down.to.line" : "pause"}
                onPress={paused ? onStart : onPause}
              />
              <DownloadButton label="Cancel" secondary onPress={onCancel} />
            </>
          ) : ready ? (
            <DownloadButton label="Done" onPress={onBack} />
          ) : (
            <DownloadButton
              label={
                offline ? "Connect to download" : `Download · ${formatDownloadSize(museum.size)}`
              }
              icon="arrow.down.to.line"
              onPress={onStart}
            />
          )}
        </View>
      </View>
    </>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Gallery.paper },
  nav: { height: 47, paddingHorizontal: 16, alignItems: "flex-end", justifyContent: "center" },
  title: { fontFamily: Fonts.display, fontSize: 34, lineHeight: 39, color: Gallery.ink },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 20, marginBottom: 8 },
  search: {
    flex: 1,
    minHeight: 45,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: Gallery.softBorder,
    borderRadius: 8,
    backgroundColor: Gallery.surface,
  },
  searchInput: { flex: 1, minWidth: 0, color: Gallery.ink, fontSize: 14, paddingVertical: 12 },
  row: { borderBottomWidth: 1, borderColor: Gallery.softBorder },
  rowOpen: {
    flex: 1,
    minHeight: 88,
    paddingVertical: 16,
    flexDirection: "row",
    gap: 11,
    alignItems: "center",
  },
  thumb: { width: 48, height: 48, borderRadius: 2 },
  placeholder: { backgroundColor: Gallery.fill, alignItems: "center", justifyContent: "center" },
  rowName: { color: Gallery.ink, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  rowStatus: { color: Gallery.muted, fontSize: 11, lineHeight: 16 },
  hero: {
    flex: 1,
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Gallery.fill,
  },
  back: {
    position: "absolute",
    top: 12,
    left: 16,
    backgroundColor: Gallery.paper,
    borderRadius: 22,
  },
  sheet: {
    marginTop: -16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: Gallery.paper,
    overflow: "hidden",
    flexShrink: 1,
  },
  promise: { color: Gallery.muted, fontSize: 14, lineHeight: 22 },
  progressSection: {
    marginTop: 17,
    paddingTop: 13,
    gap: 10,
    borderTopWidth: 1,
    borderColor: Gallery.softBorder,
  },
  progressLabel: { fontSize: 12, color: Gallery.ink, fontWeight: "600" },
  percent: { color: Gallery.ink, fontSize: 12, fontVariant: ["tabular-nums"] },
  ready: {
    marginTop: 18,
    alignSelf: "flex-start",
    backgroundColor: Gallery.highlight,
    borderRadius: 3,
    paddingVertical: 5,
    paddingHorizontal: 8,
    flexDirection: "row",
    gap: 5,
    alignItems: "center",
  },
  footer: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 11,
    borderTopWidth: 1,
    borderColor: Gallery.softBorder,
  },
});
