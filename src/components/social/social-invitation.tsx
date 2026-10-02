import type { ReactNode } from "react";

import { EmptyState } from "@/components/empty-state";
import { EmptyFriends } from "@/components/empty-state-art";

export function SocialInvitation({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  return (
    <EmptyState title={title} detail={detail} visual={<EmptyFriends />}>
      {children}
    </EmptyState>
  );
}
