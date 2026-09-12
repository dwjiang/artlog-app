import { useQueries, type RequestForQueries } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

import { DocentSection } from '@/components/scan/result/docent-section';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useDeviceReady } from '@/lib/use-device-ready';

export function ArtworkEnrichment({ artworkId }: { artworkId: Id<'artworks'> }) {
  const ready = useDeviceReady();
  const enrichmentQuery = useMemo(
    (): RequestForQueries => ready
      ? { enrichment: { query: api.artworks.enrichment, args: { artworkId } } }
      : {},
    [artworkId, ready],
  );
  const { enrichment }: { enrichment?: FunctionReturnType<typeof api.artworks.enrichment> | Error } = useQueries(enrichmentQuery);
  if (!enrichment || (!(enrichment instanceof Error) && !enrichment.docent?.length)) return null;

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold" themeColor="textSecondary">About this work</ThemedText>
      {enrichment instanceof Error ? (
        <ThemedText themeColor="textSecondary">Details about this work are unavailable right now.</ThemedText>
      ) : (
        <DocentSection docent={enrichment.docent} factSheet={enrichment.factSheet} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
});
