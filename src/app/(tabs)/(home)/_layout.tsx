import { Stack } from 'expo-router/stack';
import { Gallery } from '@/constants/theme';

export default function HomeLayout() {
  return <Stack screenOptions={{ headerTintColor: Gallery.ink, headerTransparent: true, headerBlurEffect: 'systemMaterial',
    headerStyle: { backgroundColor: 'transparent' }, headerLargeStyle: { backgroundColor: 'transparent' },
    headerTitleStyle: { color: Gallery.ink }, headerLargeTitleStyle: { color: Gallery.ink },
    headerShadowVisible: false, contentStyle: { backgroundColor: Gallery.paper } }}>
    <Stack.Screen name="index" options={{ title: 'Home', headerLargeTitleEnabled: true }} />
  </Stack>;
}
