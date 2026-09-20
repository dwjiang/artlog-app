import type { ReactNode } from 'react';
import { EmptyState } from '../empty-state';
import { ArtworkMedallions } from '../guest/artwork-preview';

export function SocialInvitation({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  return <EmptyState title={title} detail={detail} visual={<ArtworkMedallions expanded />}>{children}</EmptyState>;
}
