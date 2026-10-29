import { router, type LinkMenuActionProps } from "expo-router";
import * as Sharing from "expo-sharing";
import { Alert } from "react-native";

import type { SavedWork } from "@/db/schema";
import { scheduleRemoval } from "@/lib/collection/pending-removals";
import { captureFileUri } from "@/lib/files/photos";
import { reportError } from "@/lib/observability";
import { showErrorToast } from "@/lib/ui/toast";

export type SavedWorkAction = {
  /** Also the VoiceOver custom action name. */
  name: string;
  label: string;
  icon: NonNullable<LinkMenuActionProps["icon"]>;
  disabled?: boolean;
  run: () => void;
};

type ActionWork = Pick<SavedWork, "localId" | "owner" | "title" | "cropPath">;

async function share({ title, cropPath }: ActionWork) {
  if (!cropPath) return;
  try {
    await Sharing.shareAsync(captureFileUri(cropPath), { dialogTitle: title });
  } catch (cause) {
    reportError(cause, "collection.artwork.share");
    showErrorToast("Couldn’t share this artwork.");
  }
}

/** The owner's actions for a saved artwork, as its page offers them; `onRemoved` runs once removal is confirmed. */
export function savedWorkActions(
  work: ActionWork,
  { visitId, onRemoved }: { visitId?: string; onRemoved?: () => void } = {},
) {
  const { localId, title } = work;
  const shareAction: SavedWorkAction = {
    name: "share",
    label: "Share",
    icon: "square.and.arrow.up",
    disabled: !work.cropPath,
    run: () => {
      void share(work);
    },
  };
  const edits: SavedWorkAction[] = [
    {
      name: "edit",
      label: title === "Unidentified artwork" ? "Identify This Artwork" : "Edit Artwork Details",
      icon: "pencil",
      run: () => router.push({ pathname: "/identify-artwork", params: { savedId: localId } }),
    },
    {
      name: "addPhotos",
      label: "Add Photos",
      icon: "photo.badge.plus",
      run: () =>
        router.push({
          pathname: "/add-photos",
          params: { draftId: `saved:${localId}`, savedId: localId, title, visitId },
        }),
    },
    {
      name: "linkVisit",
      label: "Link Visit",
      icon: "link",
      run: () => router.push({ pathname: "/link-artwork", params: { savedId: localId } }),
    },
    ...(work.owner.startsWith("account:")
      ? [
          {
            name: "wallDisplay",
            label: "Wall Display Options",
            icon: "slider.horizontal.3",
            run: () => router.push({ pathname: "/wall-display", params: { savedId: localId } }),
          } satisfies SavedWorkAction,
        ]
      : []),
  ];
  const remove: SavedWorkAction = {
    name: "remove",
    label: "Remove from Collection…",
    icon: "trash",
    run: () =>
      Alert.alert(
        "Remove this artwork?",
        `Remove ${title} from your collection. You can undo this immediately afterward.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove Artwork",
            style: "destructive",
            onPress: () => {
              scheduleRemoval({ owner: work.owner, localId, title });
              onRemoved?.();
            },
          },
        ],
      ),
  };
  return { share: shareAction, edits, remove };
}
