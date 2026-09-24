import { reportError } from "@/lib/observability";
import { Alert } from "react-native";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { Stack, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { Gallery } from "@/constants/theme";
import { useLocalOwner } from "@/lib/account/owner-store";
import { selectSavedWork } from "@/db/repos/saved-works";
import { captureFileUri } from "@/lib/files/photos";
import { scheduleRemoval } from "@/lib/collection/pending-removals";
import { showToast } from "@/lib/ui/toast";

/** Header actions for an owned artwork: share the photo, and the overflow menu with editing and removal. */
export function SavedWorkToolbar({
  savedId,
  visitId,
}: {
  savedId: string;
  visitId?: string;
}) {
  const owner = useLocalOwner();
  const router = useRouter();
  const { data } = useLiveQuery(selectSavedWork(savedId, owner), [
    savedId,
    owner,
  ]);
  const work = data.find(
    (row) =>
      row.owner === owner && row.localId === savedId && row.deletedAt === null,
  );
  if (!work) return null;
  async function share() {
    if (!work?.cropPath) return;
    try {
      await Sharing.shareAsync(captureFileUri(work.cropPath), {
        dialogTitle: work.title,
      });
    } catch (cause) {
      reportError(cause, "collection.artwork.share");
      showToast("This artwork could not be shared.");
    }
  }
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button
        icon="square.and.arrow.up"
        accessibilityLabel="Share artwork"
        tintColor={Gallery.ink}
        hidesSharedBackground
        disabled={!work.cropPath}
        onPress={() => {
          void share();
        }}
      >
        Share
      </Stack.Toolbar.Button>
      <Stack.Toolbar.Menu
        icon="ellipsis"
        accessibilityLabel="More options"
        tintColor={Gallery.ink}
        hidesSharedBackground
      >
        <Stack.Toolbar.MenuAction
          onPress={() =>
            router.push({
              pathname: "/identify-artwork",
              params: { savedId: work.localId },
            })
          }
        >
          {work.title === "Unidentified artwork"
            ? "Identify this artwork"
            : "Edit artwork details"}
        </Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction
          onPress={() =>
            router.push({
              pathname: "/add-photos",
              params: {
                draftId: `saved:${work.localId}`,
                savedId: work.localId,
                title: work.title,
                visitId,
              },
            })
          }
        >
          Add photos
        </Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction
          onPress={() =>
            router.push({
              pathname: "/link-artwork",
              params: { savedId: work.localId },
            })
          }
        >
          Link visit
        </Stack.Toolbar.MenuAction>
        {owner.startsWith("account:") && (
          <Stack.Toolbar.MenuAction
            icon="slider.horizontal.3"
            onPress={() =>
              router.push({
                pathname: "/wall-display",
                params: { savedId: work.localId },
              })
            }
          >
            Wall display options
          </Stack.Toolbar.MenuAction>
        )}
        <Stack.Toolbar.MenuAction
          icon="trash"
          destructive
          onPress={() =>
            Alert.alert(
              "Remove this artwork?",
              `Remove ${work.title} from your collection. You can undo this immediately afterward.`,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Remove artwork",
                  style: "destructive",
                  onPress: () => {
                    scheduleRemoval({
                      owner: work.owner,
                      localId: work.localId,
                      title: work.title,
                    });
                    router.back();
                  },
                },
              ],
            )
          }
        >
          Remove from collection
        </Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );
}
