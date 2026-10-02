import { router, Stack } from "expo-router";
import type { ReactNode } from "react";

import { Gallery } from "@/constants/theme";
import { REPORT_NOUNS, reportHref } from "@/lib/social/report";
import type { ReportKind } from "@/shared/social/contracts";

/**
 * The header's More menu on someone else's profile, visit, or artwork. `children` adds menu actions after Report;
 * pass `Stack.Toolbar.MenuAction` elements directly, since the menu drops anything wrapped in a fragment.
 */
export function ReportToolbar({ kind, id, children }: { kind: ReportKind; id: string; children?: ReactNode }) {
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
        {children}
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );
}
