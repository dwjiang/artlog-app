import { GalleryIconButton } from "@/components/collection/gallery-icon-button";
import type { Exhibition } from "@/lib/explore/types";
import { useWantToSee } from "@/lib/explore/want-to-see";

/**
 * Saves a show to Want to see, which also reminds about it when it opens and before it closes. A `closed` show's
 * bookmark stays gray, so it recedes with the rest of its row.
 */
export function WantToSeeButton({ exhibition, closed = false }: { exhibition: Exhibition; closed?: boolean }) {
  const { saved, ready, toggle } = useWantToSee();
  const on = saved.has(exhibition.id);
  return (
    <GalleryIconButton
      icon={on ? "bookmark.fill" : "bookmark"}
      label={on ? `Remove ${exhibition.title} from Want to see` : `Want to see ${exhibition.title}`}
      tone={on && !closed ? "accent" : "muted"}
      disabled={!ready}
      onPress={() => toggle(exhibition)}
    />
  );
}
