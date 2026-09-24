import { useLocalSearchParams } from "expo-router";
import { ProfileSetupScreen } from "@/components/social/profile-setup-screen";

export default function CreateProfileRoute() {
  const { name, visitId } = useLocalSearchParams<{ name?: string; visitId?: string }>();
  return <ProfileSetupScreen suggestedName={name} visitId={visitId} />;
}
