import { socialStyles } from './social-styles';
import { useRouter } from 'expo-router';
import { ScrollView } from 'react-native';
import { useSocialSession } from '@/lib/social/use-social-session';
import { ProfileForm } from './profile-form';
import { SocialGate, SocialState } from './social-state';

export function CreateProfileScreen() {
  const session = useSocialSession();
  const router = useRouter();
  if (session.status === 'ready') return <ScrollView style={socialStyles.root} contentInsetAdjustmentBehavior="automatic">
    <SocialState title="Your profile is ready." action="Done" onAction={() => router.back()} />
  </ScrollView>;
  if (session.status !== 'profile-required') return <ScrollView style={socialStyles.root} contentInsetAdjustmentBehavior="automatic">
    <SocialGate session={session} />
  </ScrollView>;
  return <ProfileForm key={session.key} introduction="A name for your place in Artlog. Find friends, follow their visits, and share your eye for art."
    onCreated={() => { session.refresh(); router.back(); }} />;
}
