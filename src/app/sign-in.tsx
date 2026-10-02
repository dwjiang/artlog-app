import { useLocalSearchParams } from "expo-router";

import { SignInScreen } from "@/components/account/sign-in-screen";
import { readSignInContext } from "@/lib/account/sign-in-context";

export default function SignInRoute() {
  const { context, visitId, audience } = useLocalSearchParams<{
    context?: string;
    visitId?: string;
    audience?: string;
  }>();
  return (
    <SignInScreen
      context={readSignInContext(context)}
      visitId={visitId}
      audience={audience === "friends" ? audience : undefined}
    />
  );
}
