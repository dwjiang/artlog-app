import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { DocentSentence, FactChip } from '../../../../convex/lib/validators';

import { SourceChip } from './source-chip';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

/** How long a fresh card waits for its first prose before the section disappears (design §9: 2–3 s expected). */
export const DOCENT_WAIT_MS = 10_000;

export type DocentSectionProps = {
  docent?: DocentSentence[];
  factSheet?: FactChip[];
  /** Rendered above the prose only when the section shows anything. */
  title?: string;
  /** True while the backend may still be writing the sentences for this artwork. */
  pending?: boolean;
};

/** Cited docent prose (design §4.8): every sentence carries a chip per source it rests on. */
export function DocentSection({ docent, factSheet, title, pending = false }: DocentSectionProps) {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setExpired(true), DOCENT_WAIT_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  const waiting = pending && !expired && !docent?.length;
  if (!docent?.length && !waiting) return null;
  const sources = new Map(factSheet?.map((chip) => [chip.id, chip]));
  return (
    <View style={styles.section}>
      {title ? <ThemedText type="smallBold" themeColor="textSecondary">{title}</ThemedText> : null}
      {waiting ? (
        <ThemedText themeColor="textSecondary">Writing about this work…</ThemedText>
      ) : (
        <View style={styles.prose}>
          {docent?.map((line, index) => {
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
                    {[...chips.values()].map((chip) => <SourceChip key={chip.sourceUrl} label={chip.sourceLabel} url={chip.sourceUrl} />)}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  prose: { gap: Spacing.three },
  sentence: { gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
