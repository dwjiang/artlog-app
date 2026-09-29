import { SignInActions } from "@/components/account/sign-in-actions";
import { GalleryButton } from "@/components/collection/gallery-button";
import { useAccount } from "@/lib/account/use-account";

import { SocialInvitation } from "./social-invitation";

export function FriendsInvitation({ onExplore }: { onExplore: () => void }) {
  const account = useAccount();
  return (
    <SocialInvitation title={"Sign in to add friends."} detail="See the museum visits and artworks your friends share.">
      <SignInActions state={account} />
      <GalleryButton label="Find friends" fullWidth onPress={onExplore} />
    </SocialInvitation>
  );
}
