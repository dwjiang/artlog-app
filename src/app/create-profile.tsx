import { useLocalSearchParams } from "expo-router";

import { ProfileSetupScreen } from "@/components/social/profile-setup-screen";

export default function CreateProfileRoute() {
  const { name, visitId, audience } = useLocalSearchParams<{ name?: string; visitId?: string; audience?: string }>();
  return (
    <ProfileSetupScreen
      suggestedName={name}
      visitId={visitId}
      audience={audience === "friends" ? audience : undefined}
    />
  );
}
