import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";

import { useScreenActive } from "@/hooks/use-screen-active";
import { useLocalOwner } from "@/lib/account/owner-store";
import { usePendingWrapUp } from "@/lib/journal/wrap-up";

/** Opens the wrap-up sheet over Home once for a visit the app closed after its museum day; the sheet clears it. */
export function WrapUpPrompt() {
  const active = useScreenActive();
  const owner = useLocalOwner();
  const router = useRouter();
  const pending = usePendingWrapUp(owner);
  const shown = useRef<string>(undefined);
  useEffect(() => {
    if (!active || !pending || shown.current === pending) return;
    shown.current = pending;
    router.push({ pathname: "/visit-wrap-up", params: { visitId: pending } });
  }, [active, pending, router]);
  return null;
}
