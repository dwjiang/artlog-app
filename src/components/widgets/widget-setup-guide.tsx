import { Image } from "expo-image";
import { View, useWindowDimensions } from "react-native";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";

const instructions = [
  {
    image: require("../../../assets/images/widgets/setup-hold.png"),
    text: (lineBreak: string) => (
      <>
        <Text style={{ fontWeight: "600" }}>Touch and hold</Text> an empty
        {lineBreak}area on your Home Screen.{lineBreak}Wait for the apps to
        jiggle.
      </>
    ),
  },
  {
    image: require("../../../assets/images/widgets/setup-edit.png"),
    text: (lineBreak: string) => (
      <>
        Tap <Text style={{ fontWeight: "600" }}>Edit</Text> at the top left,
        {lineBreak}then <Text style={{ fontWeight: "600" }}>Add Widget</Text> in
        the menu.
      </>
    ),
  },
  {
    image: require("../../../assets/images/widgets/setup-search.png"),
    text: (lineBreak: string) => (
      <>
        Search for <Text style={{ fontWeight: "600" }}>Artlog</Text> and tap it.
        {lineBreak}Swipe to choose a size.
      </>
    ),
  },
  {
    image: require("../../../assets/images/widgets/setup-add.png"),
    text: (lineBreak: string) => (
      <>
        Tap <Text style={{ fontWeight: "600" }}>Add Widget.</Text> Back on
        {lineBreak}your Home Screen, tap{" "}
        <Text style={{ fontWeight: "600" }}>Done.</Text>
      </>
    ),
  },
];

export function WidgetSetupGuide() {
  const { fontScale } = useWindowDimensions();
  const lineBreak = fontScale > 1 ? " " : "\n";
  return (
    <View style={{ gap: 10, paddingTop: 8 }}>
      {instructions.map((instruction, index) => (
        <View
          key={index}
          style={{
            minHeight: 108,
            flexDirection: fontScale > 1.4 ? "column" : "row",
            gap: 16,
            alignItems: "flex-start",
          }}
        >
          <View
            style={[
              fontScale > 1.4 ? { width: "100%" } : { flex: 1 },
              { gap: 7, paddingTop: 2 },
            ]}
          >
            <Text
              style={{
                color: Gallery.muted,
                fontWeight: "600",
                fontSize: 17,
                lineHeight: 20,
              }}
            >
              {index + 1}.
            </Text>
            <Text style={{ fontSize: 14.5, lineHeight: 20 }}>
              {instruction.text(lineBreak)}
            </Text>
          </View>
          <Image
            source={instruction.image}
            contentFit="contain"
            accessible={false}
            style={{ width: 128, height: 112, alignSelf: "flex-end" }}
          />
        </View>
      ))}
    </View>
  );
}
