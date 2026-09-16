import { ProfileForm } from '@/components/social/profile-form';
import { WallSheet } from './wall-sheet';

export function WallProfileSheet({ onDismiss, onCreated }: { onDismiss: () => void; onCreated: () => void }) {
  return <WallSheet title="Your public wall" onDismiss={onDismiss} tall>
    <ProfileForm onCreated={onCreated}
      introduction="Give your wall a name. Choose which artworks to hang after creating your profile." />
  </WallSheet>;
}
