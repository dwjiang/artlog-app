import { FlatList } from "react-native";

import { EmptyState } from "@/components/empty-state";
import { savedExhibitions } from "@/lib/explore/lists";
import { usePlans } from "@/lib/explore/plans";
import { museumById, useExplore } from "@/lib/explore/use-explore";

import { ExhibitionRow } from "./exhibition-row";
import { listStyles } from "./list-styles";
import { WantToSeeButton } from "./plan-buttons";

/** Saved shows in closing order, so the last chance comes first. */
export function WantToSeeScreen() {
  const data = useExplore();
  const saved = savedExhibitions(data, usePlans().wantToSee);
  return (
    <FlatList
      style={listStyles.root}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[listStyles.content, saved.length === 0 && { flexGrow: 1 }]}
      data={saved}
      keyExtractor={(exhibition) => exhibition.id}
      renderItem={({ item, index }) => (
        <ExhibitionRow
          exhibition={item}
          museum={museumById(data, item.museumId)}
          today={data.today}
          thumbnail={88}
          separator={index < saved.length - 1}
          accessory={<WantToSeeButton exhibition={item} />}
        />
      )}
      ListEmptyComponent={
        <EmptyState title="Nothing saved yet." detail="Tap the bookmark on an exhibition to save it here." />
      }
    />
  );
}
