import { Text, type TextProps, useWindowDimensions } from 'react-native';

export function SocialText(props: TextProps) {
  const { fontScale } = useWindowDimensions();
  // iOS can retain old text measurements after a live Dynamic Type change.
  return <Text key={fontScale} {...props} />;
}
