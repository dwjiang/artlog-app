import { useNavigation, useRouter } from "expo-router";
import { useEffect } from "react";
import type { PendingScan } from "@/db/schema";
import { saveEditedScanCrop } from "@/lib/capture/edit-crop";
import { flushQueue } from "@/lib/queue/queue";
import { CropEditor } from "./crop-editor";

export function ScanCropEditor({
  capture,
  onCancel,
}: {
  capture: PendingScan;
  onCancel: () => void;
}) {
  const router = useRouter(),
    navigation = useNavigation();
  useEffect(() => {
    navigation.setOptions({ title: "Adjust crop", gestureEnabled: false });
    return () => navigation.setOptions({ title: "", gestureEnabled: true });
  }, [navigation]);
  return (
    <>
      <CropEditor
        photoPath={capture.photoPath}
        saveLabel="Use crop and identify"
        onCancel={onCancel}
        onSave={async (crop, isCurrent) => {
          const localId = await saveEditedScanCrop(capture.localId, crop, capture.owner, isCurrent);
          if (isCurrent()) {
            router.replace({
              pathname: "/result/[scanId]",
              params: { scanId: `local-${localId}` },
            });
            void flushQueue();
          }
        }}
      />
    </>
  );
}
