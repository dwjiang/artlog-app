import { FlatList } from "react-native";

import { EmptyState } from "@/components/empty-state";
import { savedExhibitions } from "@/lib/explore/lists";
import { usePlans } from "@/lib/explore/plans";
import { museumById, useExhibitions } from "@/lib/explore/use-explore";

import { ExhibitionRow } from "./exhibition-row";
import { ExploreState } from "./explore-state";
import { listStyles } from "./list-styles";
import { WantToSeeButton } from "./plan-buttons";

/** Saved shows in closing order, so the last chance comes first. */
export function WantToSeeScreen() {
  const plans = usePlans();
  const explore = useExhibitions([...plans.wantToSee]);
  const { data } = explore;
  if (!data) return <ExploreState view={explore} />;
  const saved = savedExhibitions(data, plans.wantToSee);
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
