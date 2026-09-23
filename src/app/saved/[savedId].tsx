import { GalleryBackToolbar } from "@/components/gallery-back-toolbar";
import { useLocalSearchParams } from "expo-router";

import { SavedWorkScreen } from "@/components/collection/saved-work-screen";
import { SavedWorkToolbar } from "@/components/collection/saved-work-toolbar";

export default function SavedWorkRoute() {
  const { savedId, visitId, photoId, editNote } = useLocalSearchParams<{
    savedId: string;
    visitId?: string;
    photoId?: string;
    editNote?: string;
  }>();
  return (
    <>
      <GalleryBackToolbar />
      <SavedWorkScreen
        savedId={savedId}
        visitId={visitId}
        photoId={photoId}
        editNote={editNote === "1"}
      />
      <SavedWorkToolbar savedId={savedId} visitId={visitId} />
    </>
  );
}
