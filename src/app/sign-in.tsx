import { useLocalSearchParams } from 'expo-router';
import { SignInScreen } from '@/components/account/sign-in-screen';
import { readSignInContext } from '@/lib/account/sign-in-context';

export default function SignInRoute() {
  const { context } = useLocalSearchParams<{ context?: string }>();
  return <SignInScreen context={readSignInContext(context)} />;
}
