import { SignInActions } from "@/components/account/sign-in-actions";
import { ActionStack } from "@/components/action-stack";
import { GalleryButton } from "@/components/collection/gallery-button";
import { useAccount } from "@/lib/account/use-account";

import { SocialInvitation } from "./social-invitation";
import { FRIENDS_SIGN_IN } from "./social-state";

export function FriendsInvitation({ onExplore }: { onExplore: () => void }) {
  const account = useAccount();
  return (
    <SocialInvitation {...FRIENDS_SIGN_IN}>
      <ActionStack textActions={<GalleryButton label="Find friends" fullWidth onPress={onExplore} />}>
        <SignInActions state={account} />
      </ActionStack>
    </SocialInvitation>
  );
}
