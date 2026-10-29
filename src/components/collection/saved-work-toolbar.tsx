import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { Stack, useRouter } from "expo-router";

import { Gallery } from "@/constants/theme";
import { selectSavedWork } from "@/db/repos/saved-works";
import { useLocalOwner } from "@/lib/account/owner-store";

import { savedWorkActions } from "./saved-work-actions";

/**
 * Header actions for an owned artwork: share the photo, and the overflow menu with editing and removal. They show,
 * disabled, before the artwork has loaded, so the header is complete from the push's first frame.
 */
export function SavedWorkToolbar({ savedId, visitId }: { savedId: string; visitId?: string }) {
  const owner = useLocalOwner();
  const router = useRouter();
  const { data } = useLiveQuery(selectSavedWork(savedId, owner), [savedId, owner]);
  const work = data.find((row) => row.owner === owner && row.localId === savedId && row.deletedAt === null);
  const actions = work && savedWorkActions(work, { visitId, onRemoved: () => router.back() });
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button
        icon="square.and.arrow.up"
        accessibilityLabel="Share artwork"
        tintColor={Gallery.ink}
        disabled={actions?.share.disabled ?? true}
        onPress={() => actions?.share.run()}
      >
        Share
      </Stack.Toolbar.Button>
      <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="More options" tintColor={Gallery.ink} disabled={!actions}>
        {actions?.edits.map((action) => (
          <Stack.Toolbar.MenuAction key={action.name} icon={action.icon} onPress={action.run}>
            {action.label}
          </Stack.Toolbar.MenuAction>
        ))}
        <Stack.Toolbar.Menu inline>
          {actions && (
            <Stack.Toolbar.MenuAction icon={actions.remove.icon} destructive onPress={actions.remove.run}>
              {actions.remove.label}
            </Stack.Toolbar.MenuAction>
          )}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );
}
