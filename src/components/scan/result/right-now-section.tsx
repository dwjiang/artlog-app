import { StyleSheet, View } from 'react-native';

import type { RightNowCard } from '../../../../convex/lib/validators';

import { SourceChip } from './source-chip';
import { ThemedText } from '@/components/themed-text';
import { HighlightHeading } from '@/components/highlight-heading';
import { Gallery, Spacing } from '@/constants/theme';

/** A web-sourced line about the artist, labelled so it reads as a different kind of claim. */
export function RightNowSection({ rightNow }: { rightNow?: RightNowCard }) {
  if (!rightNow) return null;
  return (
    <View style={styles.section}>
      <HighlightHeading>From the web</HighlightHeading>
      <ThemedText>{rightNow.text}</ThemedText>
      <SourceChip label={rightNow.sourceLabel} url={rightNow.sourceUrl} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two, paddingTop: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Gallery.separator },
});
