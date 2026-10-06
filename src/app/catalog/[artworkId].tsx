import { useLocalSearchParams } from "expo-router";

import { CatalogArtworkScreen } from "@/components/catalog/catalog-artwork-screen";

import type { Id } from "../../../convex/_generated/dataModel";

export default function CatalogArtworkRoute() {
  const { artworkId } = useLocalSearchParams<{ artworkId: Id<"artworks"> }>();
  return <CatalogArtworkScreen key={artworkId} artworkId={artworkId} />;
}
