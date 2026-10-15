import { GalleryIconButton } from "@/components/collection/gallery-icon-button";
import { useToggleBounce } from "@/hooks/use-symbol-bounce";
import type { Exhibition, ExploreMuseum } from "@/lib/explore/types";
import { useWantToSee, useWantToSeeMuseums } from "@/lib/explore/want-to-see";

/**
 * Saves a show to Want to see, which also reminds about it when it opens and before it closes. A `closed` show's
 * bookmark stays gray, so it recedes with the rest of its row.
 */
export function WantToSeeButton({ exhibition, closed = false }: { exhibition: Exhibition; closed?: boolean }) {
  const { saved, ready, toggle } = useWantToSee();
  return (
    <Bookmark
      name={exhibition.title}
      on={saved.has(exhibition.id)}
      muted={closed}
      ready={ready}
      onPress={() => toggle(exhibition)}
    />
  );
}

export function WantToSeeMuseumButton({ museum }: { museum: ExploreMuseum }) {
  const { saved, ready, toggle } = useWantToSeeMuseums();
  return <Bookmark name={museum.name} on={saved.has(museum.id)} ready={ready} onPress={() => toggle(museum)} />;
}

function Bookmark({
  name,
  on,
  muted = false,
  ready,
  onPress,
}: {
  name: string;
  on: boolean;
  muted?: boolean;
  ready: boolean;
  onPress: () => void;
}) {
  const bounce = useToggleBounce(ready ? on : undefined);
  return (
    <GalleryIconButton
      icon={on ? "bookmark.fill" : "bookmark"}
      label={on ? `Remove ${name} from Want to see` : `Want to see ${name}`}
      tone={on && !muted ? "accent" : "muted"}
      disabled={!ready}
      iconModifiers={bounce}
      onPress={onPress}
    />
  );
}
