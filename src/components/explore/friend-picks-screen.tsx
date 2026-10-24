import { SafeAreaFlatList } from "@/components/safe-area-scroll";
import { friendPicks } from "@/lib/explore/lists";
import { museumById, useExplore } from "@/lib/explore/use-explore";

import { ExhibitionRow } from "./exhibition-row";
import { ExploreState } from "./explore-state";
import { listStyles } from "./list-styles";

export function FriendPicksScreen() {
  const explore = useExplore();
  const { data } = explore;
  if (!data) return <ExploreState view={explore} />;
  const picks = friendPicks(data);
  return (
    <SafeAreaFlatList
      style={listStyles.root}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={listStyles.content}
      data={picks}
      keyExtractor={(exhibition) => exhibition.id}
      renderItem={({ item, index }) => (
        <ExhibitionRow
          exhibition={item}
          museum={museumById(data, item.museumId)}
          today={data.today}
          thumbnail={88}
          separator={index < picks.length - 1}
        />
      )}
    />
  );
}
