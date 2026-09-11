import { openBrowserAsync } from 'expo-web-browser';
import { Pressable, StyleSheet, View } from 'react-native';

import type { DocentSentence, FactChip } from '../../../../convex/lib/validators';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';

export type DocentSectionProps = {
  docent?: DocentSentence[];
  factSheet?: FactChip[];
};

/** Cited docent prose (design §4.8): every sentence carries a chip per source it rests on. */
export function DocentSection({ docent, factSheet }: DocentSectionProps) {
  if (!docent?.length) return null;
  const sources = new Map(factSheet?.map((chip) => [chip.id, chip]));
  return (
    <View style={styles.prose}>
      {docent.map((line, index) => {
        const chips = new Map<string, FactChip>();
        for (const factId of line.factIds) {
          const chip = sources.get(factId);
          if (chip) chips.set(chip.sourceUrl, chip);
        }
        return (
          <View key={index} style={styles.sentence}>
            <ThemedText>{line.sentence}</ThemedText>
            {chips.size > 0 && (
              <View style={styles.chips}>
                {[...chips.values()].map((chip) => (
                  <Pressable
                    key={chip.sourceUrl}
                    accessibilityRole="link"
                    onPress={() => { void openBrowserAsync(chip.sourceUrl); }}
                    style={styles.chip}
                  >
                    <ThemedText type="small" themeColor="accent">{chip.sourceLabel}</ThemedText>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  prose: { gap: Spacing.three },
  sentence: { gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: Spacing.three,
    backgroundColor: Colors.light.backgroundElement,
  },
});
