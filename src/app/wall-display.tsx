import { GalleryBackToolbar } from "@/components/gallery-back-toolbar";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Gallery } from "@/constants/theme";
import { WallDisplayScreen } from "@/components/collection/wall-display-screen";

export default function WallDisplayRoute() {
  const { savedId } = useLocalSearchParams<{ savedId: string }>();
  return (
    <>
      <GalleryBackToolbar />
      <WallDisplayScreen savedId={savedId} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          hidesSharedBackground
          tintColor={Gallery.accent}
          onPress={() => router.back()}
        >
          Done
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );
}
