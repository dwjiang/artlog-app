import { PopOnTurnOn } from "@/components/pop-on-turn-on";

import { ReactionIcon } from "./reaction-icon";

export function LikeHeart({ liked, size, color }: { liked: boolean | undefined; size?: number; color?: string }) {
  return (
    <PopOnTurnOn on={liked}>
      <ReactionIcon kind="heart" filled={!!liked} size={size} color={color} />
    </PopOnTurnOn>
  );
}
