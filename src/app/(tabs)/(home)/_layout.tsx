import { Stack } from "expo-router/stack";
import { NavigationTheme } from "@/constants/theme";

export default function HomeLayout() {
  return (
    <Stack screenOptions={NavigationTheme}>
      <Stack.Screen name="index" options={{ title: "Home", headerShown: false }} />
    </Stack>
  );
}
