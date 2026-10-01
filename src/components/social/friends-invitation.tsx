import { SignInActions } from "@/components/account/sign-in-actions";
import { ActionStack } from "@/components/action-stack";
import { GalleryButton } from "@/components/collection/gallery-button";
import { useAccount } from "@/lib/account/use-account";

import { SocialInvitation } from "./social-invitation";

export function FriendsInvitation({ onExplore }: { onExplore: () => void }) {
  const account = useAccount();
  return (
    <SocialInvitation title={"Sign in to add friends."} detail="See the museum visits and artworks your friends share.">
      <ActionStack textActions={<GalleryButton label="Find friends" fullWidth onPress={onExplore} />}>
        <SignInActions state={account} />
      </ActionStack>
    </SocialInvitation>
  );
}
