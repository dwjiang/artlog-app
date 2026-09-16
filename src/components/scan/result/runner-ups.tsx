import { TentativeOriginNotice } from './tentative-origin-notice';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import type { ResultCandidate } from '@/lib/result/state';

export type RunnerUpsProps = {
  candidates: ResultCandidate[];
  onPick: (candidate: ResultCandidate) => void;
};

/** Similar works as rows; a museum thumbnail appears only where the server hotlinked a public-domain one. */
export function RunnerUps({ candidates, onPick }: RunnerUpsProps) {
  return (
    <View style={styles.list}>
      {candidates.map((candidate) => (
        <Pressable
          key={candidate.objectId}
          accessibilityRole="button"
          accessibilityLabel={`${candidate.title}, ${candidate.artist}`}
          onPress={() => onPick(candidate)}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          {candidate.thumbnailUrl ? (
            <Image source={candidate.thumbnailUrl} contentFit="cover" accessibilityLabel={`${candidate.identityStatus === 'tentative' ? 'Visitor' : 'Museum'} image of ${candidate.title}`} style={styles.thumbnail} />
          ) : (
            <View style={[styles.thumbnail, styles.placeholder]} />
          )}
          <View style={styles.text}>
            <ThemedText numberOfLines={2}>{candidate.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
              {[candidate.artist, candidate.institution].filter(Boolean).join(' · ')}
            </ThemedText>
            {candidate.identityStatus === 'tentative' && <TentativeOriginNotice />}
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.two, borderRadius: Spacing.three, backgroundColor: Colors.light.backgroundElement },
  pressed: { opacity: 0.6 },
  thumbnail: { width: 56, height: 56, borderRadius: Spacing.two, backgroundColor: Colors.light.backgroundSelected },
  placeholder: { borderWidth: 2, borderColor: Colors.light.textSecondary },
  text: { flex: 1, gap: Spacing.half },
});
