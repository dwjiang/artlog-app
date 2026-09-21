import { AppleSignInAction } from '@/components/account/apple-sign-in-action';
import { GalleryButton } from '@/components/collection/gallery-button';
import { useAccount } from '@/lib/account/use-account';
import { SocialInvitation } from './social-invitation';

export function FriendsInvitation({ onExplore }: { onExplore: () => void }) {
  const account = useAccount();
  return <SocialInvitation title={'Find your\nfriends.'} detail="Connect with friends to see their museum visits and the art they love.">
    <AppleSignInAction state={account} />
    <GalleryButton label="Find friends" fullWidth onPress={onExplore} />
  </SocialInvitation>;
}
