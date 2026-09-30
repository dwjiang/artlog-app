import { router, Stack } from "expo-router";

import { Gallery } from "@/constants/theme";
import { REPORT_NOUNS, reportHref } from "@/lib/social/report";
import type { ReportKind } from "@/shared/social/contracts";

/** The header's More menu on someone else's profile, visit, or artwork. */
export function ReportToolbar({ kind, id }: { kind: ReportKind; id: string }) {
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu
        icon="ellipsis"
        accessibilityLabel="More options"
        tintColor={Gallery.ink}
        hidesSharedBackground
      >
        <Stack.Toolbar.MenuAction icon="flag" onPress={() => router.push(reportHref(kind, id))}>
          {`Report ${REPORT_NOUNS[kind]}`}
        </Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );
}
