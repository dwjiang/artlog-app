import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";

import { Gallery } from "@/constants/theme";

import { ThemedText as Text } from "./themed-text";

export function EmptyPodium() {
  return (
    <View accessibilityElementsHidden style={styles.podium}>
      {[2, 1, 3].map((place) => (
        <View
          key={place}
          style={[
            styles.step,
            {
              height: place === 1 ? 110 : place === 2 ? 78 : 58,
              backgroundColor: place === 1 ? Gallery.highlight : Gallery.fill,
            },
          ]}
        >
          <Text allowFontScaling={false} variant="display" style={styles.place}>
            {place}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function EmptyPaper({ kind }: { kind: "label" | "note" }) {
  return (
    <View accessibilityElementsHidden style={styles.paperArea}>
      <View style={[styles.paper, { transform: [{ rotate: kind === "label" ? "-5deg" : "4deg" }] }]}>
        <Image
          source={kind === "label" ? "sf:building.columns" : "sf:quote.opening"}
          tintColor={Gallery.accent}
          accessible={false}
          style={{ width: 27, height: 27 }}
        />
        {[0, 1, 2].map((line) => (
          <View key={line} style={[styles.rule, { width: line === 2 ? "60%" : "100%" }]} />
        ))}
      </View>
    </View>
  );
}

export function EmptyMap() {
  return (
    <View accessibilityElementsHidden style={styles.map}>
      {[30, 95, 160].map((left) => (
        <View key={left} style={[styles.road, { left, transform: [{ rotate: "24deg" }] }]} />
      ))}
      <View style={[styles.road, { width: "100%", height: 14, top: 55 }]} />
      <View style={styles.park} />
      <View style={styles.location}>
        <View style={styles.dot} />
      </View>
    </View>
  );
}

export function EmptyViewfinder() {
  return (
    <View accessibilityElementsHidden style={styles.viewfinder}>
      {(["topLeft", "topRight", "bottomLeft", "bottomRight"] as const).map((corner) => (
        <View key={corner} style={[styles.corner, styles[corner]]} />
      ))}
      <Canvas width={80} height={96} />
    </View>
  );
}

export function EmptyFrames() {
  return (
    <View accessibilityElementsHidden style={styles.frames}>
      <View style={styles.sideFrame} />
      <Canvas width={88} height={108} />
      <View style={styles.sideFrame} />
    </View>
  );
}

export function EmptyTicket() {
  return (
    <View accessibilityElementsHidden style={styles.ticketArea}>
      <View style={styles.ticket}>
        <View style={styles.ticketMain}>
          <Image source="sf:star.fill" tintColor={Gallery.accent} accessible={false} style={styles.ticketStar} />
          <View style={[styles.ticketRule, { width: "80%" }]} />
          <View style={[styles.ticketRule, { width: "50%" }]} />
        </View>
        <View style={styles.ticketStub}>
          <Image
            source="sf:building.columns.fill"
            tintColor={Gallery.accent}
            accessible={false}
            style={styles.ticketMuseum}
          />
        </View>
        <View style={styles.perforation}>
          {[0, 1, 2, 3, 4, 5].map((dash) => (
            <View key={dash} style={styles.dash} />
          ))}
        </View>
        <View style={[styles.notch, { top: -9 }]} />
        <View style={[styles.notch, { bottom: -9 }]} />
      </View>
    </View>
  );
}

export function EmptyScans() {
  return (
    <View accessibilityElementsHidden style={styles.scans}>
      <View style={[styles.scanBack, { transform: [{ rotate: "-9deg" }, { translateX: -14 }] }]} />
      <View style={[styles.scanBack, { transform: [{ rotate: "7deg" }, { translateX: 14 }] }]} />
      <View style={styles.scanFront}>
        <Canvas width={78} height={94} />
      </View>
    </View>
  );
}

/** A flat painting: highlight ground, accent sun and a soft hill. */
function Canvas({ width, height }: { width: number; height: number }) {
  const sun = Math.round(width * 0.2);
  const hill = Math.round(width * 1.12);
  return (
    <View style={[styles.canvas, { width, height }]}>
      <View
        style={[
          styles.hill,
          { width: hill, height: hill, borderRadius: hill / 2, left: (width - hill) / 2, top: height * 0.65 },
        ]}
      />
      <View style={[styles.sun, { width: sun, height: sun, borderRadius: sun / 2, top: sun, right: sun }]} />
    </View>
  );
}

export function EmptyFriends() {
  return (
    <View accessibilityElementsHidden style={styles.friends}>
      {[56, 80, 56].map((size, index) => {
        const center = index === 1;
        return (
          <View
            key={index}
            style={[
              styles.friend,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: center ? Gallery.highlight : Gallery.fill,
                zIndex: center ? 1 : 0,
              },
              index > 0 && { marginLeft: -12 },
            ]}
          >
            <Image
              source="sf:person.fill"
              tintColor={center ? Gallery.accent : Gallery.muted}
              accessible={false}
              style={{ width: size * 0.4, height: size * 0.4 }}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  podium: {
    height: 136,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 8,
  },
  step: {
    width: 72,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  place: { fontSize: 34, lineHeight: 42 },
  paperArea: { height: 152, justifyContent: "center", alignItems: "center" },
  paper: {
    width: 208,
    gap: 12,
    padding: 20,
    backgroundColor: Gallery.surface,
    borderWidth: 0.5,
    borderColor: Gallery.separator,
    boxShadow: "0 4px 10px rgba(17,17,17,0.08)",
  },
  rule: { height: 2, backgroundColor: Gallery.separator },
  map: {
    width: 250,
    height: 140,
    borderRadius: 12,
    backgroundColor: "#EEEFE7",
    overflow: "hidden",
    alignSelf: "center",
  },
  road: {
    position: "absolute",
    width: 12,
    height: 170,
    top: -15,
    backgroundColor: Gallery.paper,
  },
  park: {
    position: "absolute",
    width: 54,
    height: 40,
    backgroundColor: "#D9E4C8",
    borderRadius: 10,
    left: 155,
    top: 84,
    transform: [{ rotate: "24deg" }],
  },
  location: {
    position: "absolute",
    left: 102,
    top: 48,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Gallery.highlight,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 16,
    height: 16,
    backgroundColor: Gallery.accent,
    borderWidth: 3,
    borderColor: Gallery.surface,
    borderRadius: 8,
  },
  viewfinder: {
    width: 160,
    height: 136,
    alignItems: "center",
    justifyContent: "center",
  },
  corner: { position: "absolute", width: 28, height: 28, borderColor: Gallery.accent },
  topLeft: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 10 },
  topRight: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 10 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 10 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 10 },
  canvas: { borderRadius: 2, backgroundColor: Gallery.highlight, overflow: "hidden" },
  hill: { position: "absolute", backgroundColor: Gallery.accentBorder },
  sun: { position: "absolute", backgroundColor: Gallery.accent },
  frames: { height: 136, flexDirection: "row", alignItems: "center", gap: 12 },
  sideFrame: { width: 56, height: 72, borderRadius: 2, backgroundColor: Gallery.fill },
  ticketArea: { height: 136, justifyContent: "center" },
  ticket: { width: 216, height: 100, flexDirection: "row" },
  ticketMain: {
    flex: 1,
    gap: 10,
    padding: 18,
    justifyContent: "flex-end",
    backgroundColor: Gallery.highlight,
    borderTopLeftRadius: 10,
    borderBottomLeftRadius: 10,
  },
  ticketStar: { position: "absolute", top: 16, left: 18, width: 16, height: 16 },
  ticketRule: { height: 6, borderRadius: 3, backgroundColor: Gallery.accentBorder },
  ticketStub: {
    width: 58,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Gallery.highlight,
    borderTopRightRadius: 10,
    borderBottomRightRadius: 10,
  },
  ticketMuseum: { width: 24, height: 24 },
  // Drawn dashes: iOS draws dashed borders only when every side has the same width.
  perforation: {
    position: "absolute",
    left: 216 - 58 - 1,
    top: 14,
    bottom: 14,
    justifyContent: "space-between",
  },
  dash: { width: 2, height: 6, borderRadius: 1, backgroundColor: Gallery.paper },
  notch: {
    position: "absolute",
    // Centered on the perforation.
    left: 216 - 58 - 9,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Gallery.paper,
  },
  scans: { width: 160, height: 136, alignItems: "center", justifyContent: "center" },
  scanBack: {
    position: "absolute",
    width: 90,
    height: 106,
    borderRadius: 4,
    backgroundColor: Gallery.avatar,
  },
  scanFront: { padding: 6, borderRadius: 4, backgroundColor: Gallery.paper },
  friends: { height: 96, flexDirection: "row", alignItems: "center" },
  friend: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: Gallery.paper,
  },
});
