import { FlatList } from "react-native";

import { friendPicks } from "@/lib/explore/lists";
import { museumById, useExplore } from "@/lib/explore/use-explore";

import { ExhibitionRow } from "./exhibition-row";
import { listStyles } from "./list-styles";

export function FriendPicksScreen() {
  const data = useExplore();
  const picks = friendPicks(data);
  return (
    <FlatList
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
