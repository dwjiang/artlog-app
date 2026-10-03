import { BottomSheet, RNHostView } from "@expo/ui";
import { Image } from "expo-image";
import { useState } from "react";
import { FlatList, ScrollView, View, useWindowDimensions } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { NativeSegmentedPicker } from "@/components/collection/native-segmented-picker";
import { SavedWorkImage } from "@/components/collection/saved-work-image";
import { LoadingRing } from "@/components/loading-ring";
import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { useFittedSheetHeight } from "@/hooks/use-fitted-sheet";
import { widgetVisitDate } from "@/lib/widgets/widget-collection";
import { useWidgetCollection } from "@/lib/widgets/widget-provider";
import { currentWidgetIndex } from "@/lib/widgets/widget-publisher";
import { widgetCaptions, widgetColors, widgetFrames, type WidgetSize } from "@/lib/widgets/widget-settings";

import { WidgetSettingRow, WidgetTile } from "./widget-controls";
import { WidgetFrameSample, WidgetPreview } from "./widget-preview";
import { WidgetSetupGuide } from "./widget-setup-guide";

type Sheet = "source" | "visit" | "artwork" | "caption" | "frame" | "color" | "help";
const sheetTitles: Record<Sheet, string> = {
  source: "Artwork source",
  visit: "Choose a visit",
  artwork: "Choose one artwork",
  caption: "Caption",
  frame: "Painting frame",
  color: "Widget color",
  help: "Add to Home Screen",
};

export function WidgetsScreen() {
  const collection = useWidgetCollection();
  const { preferences, update, prepared, artworks, allArtworks, visits, encounters, loading, syncing, error, retry } =
    collection;
  const { width, fontScale } = useWindowDimensions();
  const [size, setSize] = useState<WidgetSize>("medium");
  const [sheet, setSheet] = useState<Sheet>("source");
  const [presented, setPresented] = useState(false);
  const fitted = useFittedSheetHeight();
  const contentWidth = Math.min(width - 40, 420);
  const mediumHeight = (contentWidth * 158) / 334;
  const artwork = prepared[currentWidgetIndex(prepared.length)];
  const color = widgetColors.find((option) => option.value === preferences.color)!;
  const finish = widgetFrames.find((option) => option.value === preferences.frame)!;
  const caption = widgetCaptions.find((option) => option.value === preferences.caption)!;
  const { source } = preferences;
  const selectedVisit = source.kind === "visit" ? visits.find((visit) => visit.localId === source.id) : undefined;
  const selectedArtwork = source.kind === "artwork" ? allArtworks.find((art) => art.id === source.id) : undefined;
  const sourceDescription =
    preferences.source.kind === "collection"
      ? `Whole collection · ${allArtworks.length} ${allArtworks.length === 1 ? "artwork" : "artworks"}`
      : preferences.source.kind === "visit"
        ? `A visit · ${selectedVisit?.venueName ?? "Visit unavailable"}`
        : `One artwork · ${selectedArtwork?.title ?? "Artwork unavailable"}`;
  const hasParent = sheet === "visit" || sheet === "artwork";
  const pickers = sheet === "caption" || sheet === "frame" || sheet === "color";
  const open = (value: Sheet) => {
    setSheet(value);
    setPresented(true);
  };
  const close = () => setPresented(false);
  const preview = (previewSize: WidgetSize) => (
    <View
      style={{
        alignItems: "center",
        minHeight: mediumHeight,
        justifyContent: "center",
      }}
    >
      <WidgetPreview
        artwork={artwork}
        settings={preferences}
        size={previewSize}
        width={previewSize === "medium" ? contentWidth : mediumHeight}
      />
    </View>
  );
  const visitOptions = visits
    .map((visit) => ({
      visit,
      works: allArtworks.filter((art) =>
        encounters.some(
          (encounter) =>
            encounter.deletedAt === null
            && encounter.visitLocalId === visit.localId
            && encounter.savedLocalId === art.id,
        ),
      ),
    }))
    .filter((option) => option.works.length > 0);

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: Gallery.paper }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 4,
          paddingBottom: 32,
          alignItems: "center",
        }}
      >
        <View style={{ width: contentWidth }}>
          <Text
            variant={fontScale > 1.4 ? "display" : "pageTitle"}
            accessibilityRole="header"
            style={[{ marginBottom: 24 }, fontScale > 1.4 ? undefined : { fontSize: 42, lineHeight: 54 }]}
          >
            Widgets
          </Text>
          {preview(size)}
          <View
            style={{
              flexDirection: fontScale > 1.4 ? "column" : "row",
              justifyContent: "space-between",
              alignItems: fontScale > 1.4 ? "stretch" : "center",
              gap: 12,
              paddingVertical: 14,
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: "600" }}>Preview size</Text>
            <View style={{ width: fontScale > 1.4 ? "100%" : 172 }}>
              <NativeSegmentedPicker
                label="Preview size"
                value={size}
                onChange={setSize}
                options={[
                  { value: "small", label: "Small" },
                  { value: "medium", label: "Medium" },
                ]}
              />
            </View>
          </View>
          <View
            style={{
              borderTopWidth: 0.5,
              borderTopColor: Gallery.softBorder,
              marginTop: 8,
            }}
          >
            <WidgetSettingRow title="Artwork source" subtitle={sourceDescription} onPress={() => open("source")} />
            {size === "medium" && (
              <>
                <WidgetSettingRow title="Caption" subtitle={caption.name} onPress={() => open("caption")} />
                <WidgetSettingRow
                  title="Painting frame"
                  detail={
                    finish.name
                    + (finish.value === "none" ? "" : ` · ${preferences.frameWidth === "slim" ? "Slim" : "Wide"}`)
                  }
                  onPress={() => open("frame")}
                />
              </>
            )}
            <WidgetSettingRow
              title="Widget color"
              detail={color.name}
              swatch={color.color}
              onPress={() => open("color")}
            />
          </View>
          {(loading || (syncing && !artwork && artworks.length > 0)) && (
            <View style={{ paddingTop: 12 }}>
              <LoadingRing accessibilityLabel="Preparing your widget" />
            </View>
          )}
          {!loading && !syncing && prepared.length === 0 && (
            <Text variant="secondary" themeColor="textSecondary" style={{ marginTop: 16 }}>
              {allArtworks.length === 0
                ? "Save a painting to see it in your widget."
                : "No photos are available for this source. Choose another artwork or visit."}
            </Text>
          )}
          {error && (
            <View style={{ gap: 8, paddingTop: 12 }}>
              <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>
                {error}
              </Text>
              <GalleryButton label="Retry" onPress={retry} />
            </View>
          )}
          <View style={{ paddingTop: 20 }}>
            <GalleryButton label="How to add the widget" variant="filled" fullWidth onPress={() => open("help")} />
          </View>
        </View>
      </ScrollView>
      <BottomSheet
        isPresented={presented}
        onDismiss={close}
        containerColor={Gallery.paper}
        contentPadding={0}
        snapPoints={[fitted.height ? { height: fitted.height } : "half"]}
      >
        <RNHostView>
          <View style={{ height: fitted.height, backgroundColor: Gallery.paper }}>
            <View
              onLayout={fitted.onHeaderLayout}
              style={{
                paddingHorizontal: 20,
                paddingTop: sheet === "help" ? 30 : 22,
                paddingBottom: 16,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text variant="display" accessibilityRole="header" style={{ flex: 1, fontSize: 29, lineHeight: 36 }}>
                  {sheetTitles[sheet]}
                </Text>
                <MotionPressable
                  accessibilityRole="button"
                  accessibilityLabel={hasParent ? "Back to artwork source" : "Close instructions and settings"}
                  onPress={hasParent ? () => setSheet("source") : close}
                  style={{
                    minWidth: 44,
                    minHeight: 44,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Image
                    source={hasParent ? "sf:chevron.left" : "sf:xmark"}
                    tintColor={hasParent ? Gallery.accent : Gallery.muted}
                    accessible={false}
                    style={{ width: 18, height: 18 }}
                  />
                </MotionPressable>
              </View>
            </View>
            {sheet === "visit" ? (
              <FlatList
                data={visitOptions}
                keyExtractor={({ visit }) => visit.localId}
                onContentSizeChange={fitted.onContentSizeChange}
                contentContainerStyle={{
                  paddingHorizontal: 20,
                  paddingBottom: 20,
                }}
                ListEmptyComponent={
                  <Text variant="body" themeColor="textSecondary">
                    No visits with saved artwork yet.
                  </Text>
                }
                renderItem={({ item: { visit, works } }) => (
                  <WidgetSettingRow
                    title={visit.venueName}
                    subtitle={`${widgetVisitDate(visit.visitedOn)} · ${works.length} ${works.length === 1 ? "artwork" : "artworks"}`}
                    selected={preferences.source.kind === "visit" && preferences.source.id === visit.localId}
                    onPress={() => {
                      update({ source: { kind: "visit", id: visit.localId } });
                      close();
                    }}
                  >
                    <SavedWorkImage
                      path={works[0]?.paths[0] ?? null}
                      title={works[0]?.title ?? visit.venueName}
                      contain
                      style={{ width: 50, height: 64 }}
                    />
                  </WidgetSettingRow>
                )}
              />
            ) : sheet === "artwork" ? (
              <FlatList
                data={allArtworks}
                keyExtractor={(art) => art.id}
                onContentSizeChange={fitted.onContentSizeChange}
                contentContainerStyle={{
                  paddingHorizontal: 20,
                  paddingBottom: 20,
                }}
                ListEmptyComponent={
                  <Text variant="body" themeColor="textSecondary">
                    No saved artworks yet.
                  </Text>
                }
                renderItem={({ item: art }) => (
                  <WidgetSettingRow
                    title={art.title}
                    subtitle={art.artist}
                    selected={preferences.source.kind === "artwork" && preferences.source.id === art.id}
                    onPress={() => {
                      update({ source: { kind: "artwork", id: art.id } });
                      close();
                    }}
                  >
                    <SavedWorkImage
                      path={art.paths[0] ?? null}
                      title={art.title}
                      contain
                      style={{ width: 50, height: 64 }}
                    />
                  </WidgetSettingRow>
                )}
              />
            ) : (
              <ScrollView
                contentInsetAdjustmentBehavior="never"
                alwaysBounceVertical={false}
                onContentSizeChange={fitted.onContentSizeChange}
                contentContainerStyle={{
                  paddingHorizontal: 20,
                  paddingBottom: 20,
                  gap: 16,
                }}
              >
                {pickers && preview(sheet === "color" ? size : "medium")}
                {sheet === "source" && (
                  <View>
                    <WidgetSettingRow
                      title="Whole collection"
                      subtitle={`Rotate through all ${allArtworks.length} saved artworks.`}
                      selected={preferences.source.kind === "collection"}
                      onPress={() => {
                        update({ source: { kind: "collection" } });
                        close();
                      }}
                    />
                    <WidgetSettingRow
                      title="A visit"
                      subtitle="Rotates through this visit’s artworks."
                      selected={preferences.source.kind === "visit"}
                      onPress={() => setSheet("visit")}
                    />
                    <WidgetSettingRow
                      title="One artwork"
                      subtitle="Keep a particular painting on display."
                      selected={preferences.source.kind === "artwork"}
                      onPress={() => setSheet("artwork")}
                    />
                  </View>
                )}
                {sheet === "caption" && (
                  <View>
                    {widgetCaptions.map((option) => (
                      <WidgetSettingRow
                        key={option.value}
                        title={option.name}
                        subtitle={"description" in option ? option.description : undefined}
                        selected={preferences.caption === option.value}
                        onPress={() => update({ caption: option.value })}
                      />
                    ))}
                  </View>
                )}
                {sheet === "frame" && (
                  <>
                    <Text variant="section" accessibilityRole="header">
                      Finish
                    </Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                      {widgetFrames.map((option) => (
                        <WidgetTile
                          key={option.value}
                          label={option.value === "none" ? option.name : `${option.name} frame`}
                          selected={preferences.frame === option.value}
                          width={((contentWidth - 24) / 5) * Math.max(1, fontScale)}
                          onPress={() => update({ frame: option.value })}
                        >
                          <View
                            style={{
                              paddingVertical: 8,
                              alignItems: "center",
                              gap: 8,
                              borderRadius: 8,
                              borderWidth: preferences.frame === option.value ? 1.2 : 0.7,
                              borderColor: preferences.frame === option.value ? Gallery.ink : Gallery.softBorder,
                              backgroundColor: preferences.frame === option.value ? Gallery.highlight : "transparent",
                            }}
                          >
                            {artwork ? (
                              <WidgetFrameSample
                                artwork={artwork}
                                settings={{
                                  ...preferences,
                                  frame: option.value,
                                  frameWidth: "wide",
                                }}
                              />
                            ) : (
                              <View
                                style={{
                                  width: 42,
                                  height: 48,
                                  backgroundColor: Gallery.fill,
                                  borderWidth: option.value === "none" ? 0 : 4,
                                  borderColor: option.color,
                                }}
                              />
                            )}
                            <Text style={{ fontSize: 10, textAlign: "center" }}>{option.name}</Text>
                          </View>
                        </WidgetTile>
                      ))}
                    </ScrollView>
                    <Text variant="section" accessibilityRole="header" style={{ paddingTop: 8 }}>
                      Width
                    </Text>
                    <NativeSegmentedPicker
                      label="Frame width"
                      value={preferences.frameWidth}
                      disabled={preferences.frame === "none"}
                      onChange={(frameWidth) => update({ frameWidth })}
                      options={[
                        { value: "slim", label: "Slim" },
                        { value: "wide", label: "Wide" },
                      ]}
                    />
                    <Text variant="metadata" themeColor="textSecondary">
                      Applies to the medium widget.
                    </Text>
                  </>
                )}
                {sheet === "color" && (
                  <>
                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <Text variant="section" accessibilityRole="header">
                        Background
                      </Text>
                      <Text variant="secondary" themeColor="textSecondary">
                        {color.name}
                      </Text>
                    </View>
                    <View
                      style={{
                        flexDirection: "row",
                        flexWrap: "wrap",
                        gap: 12,
                      }}
                    >
                      {widgetColors.map((option) => (
                        <WidgetTile
                          key={option.value}
                          label={`${option.name} background`}
                          selected={preferences.color === option.value}
                          width={(contentWidth - 24) / 3}
                          onPress={() => update({ color: option.value })}
                        >
                          <View
                            style={{
                              padding: 9,
                              gap: 10,
                              borderRadius: 10,
                              borderWidth: preferences.color === option.value ? 2 : 1,
                              borderColor: preferences.color === option.value ? Gallery.accent : Gallery.softBorder,
                            }}
                          >
                            <View
                              style={{
                                height: 35,
                                borderRadius: 7,
                                borderWidth: 0.7,
                                borderColor: "#92968C",
                                backgroundColor: option.color,
                                alignItems: "flex-end",
                                justifyContent: "center",
                                paddingRight: 6,
                              }}
                            >
                              {preferences.color === option.value && (
                                <Image
                                  source="sf:checkmark.circle.fill"
                                  tintColor={Gallery.accent}
                                  style={{ width: 20, height: 20 }}
                                />
                              )}
                            </View>
                            <Text style={{ fontSize: 13, textAlign: "center" }}>{option.name}</Text>
                          </View>
                        </WidgetTile>
                      ))}
                    </View>
                    <Text variant="metadata" themeColor="textSecondary">
                      Applies to small and medium widgets.
                    </Text>
                  </>
                )}
                {sheet === "help" && <WidgetSetupGuide />}
              </ScrollView>
            )}
            {/* Always mounted, so a sheet without a button measures its footer as empty. */}
            <View onLayout={fitted.onFooterLayout}>
              {(pickers || sheet === "help") && (
                <View
                  style={{
                    paddingHorizontal: 20,
                    paddingTop: 4,
                    paddingBottom: sheet === "help" ? 20 : 16,
                  }}
                >
                  <GalleryButton
                    label={sheet === "help" ? "Got it" : "Done"}
                    size={sheet === "help" ? "compact" : "regular"}
                    variant="filled"
                    fullWidth
                    onPress={close}
                  />
                </View>
              )}
            </View>
          </View>
        </RNHostView>
      </BottomSheet>
    </>
  );
}
