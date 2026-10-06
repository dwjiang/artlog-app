import type { ReactNode } from "react";

import { EmptyActions, EmptyCard, EmptyState, type EmptyAction } from "@/components/empty-state";
import { EmptyFriends } from "@/components/empty-state-art";

/** `card` sets the invitation as a gray card under other content, drawing only the action props. */
export function SocialInvitation({
  title,
  detail,
  card = false,
  action,
  secondaryAction,
  children,
}: {
  title: string;
  detail: string;
  card?: boolean;
  action?: EmptyAction;
  secondaryAction?: EmptyAction;
  children?: ReactNode;
}) {
  if (card) return <EmptyCard title={title} detail={detail} action={action} secondaryAction={secondaryAction} />;
  return (
    <EmptyState title={title} detail={detail} visual={<EmptyFriends />}>
      {children ?? <EmptyActions action={action} secondaryAction={secondaryAction} />}
    </EmptyState>
  );
}
