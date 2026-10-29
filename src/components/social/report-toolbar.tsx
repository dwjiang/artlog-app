import { router, Stack } from "expo-router";
import type { ReactNode } from "react";

import { Gallery } from "@/constants/theme";
import { reportHref, reportTitle } from "@/lib/social/report";
import type { ReportKind } from "@/shared/social/contracts";

/**
 * The header's More menu on someone else's profile, visit, or artwork: `leading` actions, Report, then `children` in
 * a section of their own, such as Block. Pass `Stack.Toolbar.MenuAction` elements directly, since the menu drops
 * anything wrapped in a fragment.
 */
export function ReportToolbar({
  kind,
  id,
  leading,
  children,
}: {
  kind: ReportKind;
  id: string;
  leading?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="More options" tintColor={Gallery.ink}>
        {leading}
        <Stack.Toolbar.MenuAction icon="flag" onPress={() => router.push(reportHref(kind, id))}>
          {`${reportTitle(kind)}…`}
        </Stack.Toolbar.MenuAction>
        {children ? <Stack.Toolbar.Menu inline>{children}</Stack.Toolbar.Menu> : null}
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );
}
