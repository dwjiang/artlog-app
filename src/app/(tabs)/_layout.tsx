import { NativeTabs } from 'expo-router/unstable-native-tabs';

export const unstable_settings = {
  anchor: '(scan)',
};

export default function TabsLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="(scan)">
        <NativeTabs.Trigger.Label>Scan</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="camera.viewfinder" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(collection)">
        <NativeTabs.Trigger.Label>Collection</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'square.grid.2x2', selected: 'square.grid.2x2.fill' }}
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(settings)">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="gearshape" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
