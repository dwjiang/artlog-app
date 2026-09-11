import { Button, Host } from '@expo/ui';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Id } from '../../../../convex/_generated/dataModel';
import type { LabelFlowDisplay } from '../../../../convex/lib/validators';
import { ConsentSheet } from '../label/consent-sheet';
import { LabelActions } from '../label/label-actions';
import { VerifiedFieldsForm } from '../label/verified-fields-form';
import { SearchConsentSheet } from './search-consent-sheet';
import { SourceChip } from './source-chip';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { PendingScan } from '@/db/schema';
import { contributeLabel, contributionErrorMessage, type ContributionOutcome } from '@/lib/label/contribute';
import { canSaveLabel, canShareLabel, formStateFromFlow, setFieldValue, unlockField } from '@/lib/label/fields';
import type { MuseumSearchStage } from '@/lib/museum-search/flow';
import type { MuseumSearchController } from '@/lib/museum-search/use-museum-search';
import { useSaveResult } from '@/lib/result/use-save-result';

export const MUSEUM_SEARCH_BUTTON = "Search this museum's collection";
const STAGE_TEXT: Record<MuseumSearchStage, string> = {
  describe: 'Preparing your photo', search: 'Describing the painting and searching the site',
  check: 'Comparing the museum’s images on your phone', done: 'Image confirmed', none: 'Search finished',
};

type Props = { search: MuseumSearchController; scanId: Id<'scans'>; capture?: PendingScan };

export function MuseumSearchSection({ search, scanId, capture }: Props) {
  if (!search.visible) return null;
  return (
    <View style={styles.section}>
      {search.flow ? (
        <MuseumSearchResult key={search.flow.updatedAt} flow={search.flow} scanId={scanId} capture={capture} />
      ) : (
        <>
          <Host matchContents colorScheme="light">
            <Button variant="outlined" label={MUSEUM_SEARCH_BUTTON} disabled={!search.canSearch || search.running} onPress={search.requestSearch} />
          </Host>
          {search.running ? (
            <View accessibilityLiveRegion="polite" style={styles.progress}>
              <ThemedText>{"Searching the museum's collection…"}</ThemedText>
              {search.progress && <ThemedText type="small" themeColor="textSecondary">{STAGE_TEXT[search.progress]}</ThemedText>}
            </View>
          ) : search.message && <ThemedText themeColor="textSecondary">{search.message}</ThemedText>}
        </>
      )}
      <SearchConsentSheet open={search.consentOpen} onGranted={search.acceptConsent} onDismiss={search.dismissConsent} />
    </View>
  );
}

function MuseumSearchResult({ flow, scanId, capture }: { flow: LabelFlowDisplay; scanId: Id<'scans'>; capture?: PendingScan }) {
  const router = useRouter();
  const [form, setForm] = useState(() => formStateFromFlow(flow));
  const { saving, savedId, error: saveError, save } = useSaveResult();
  const [consentOpen, setConsentOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState<ContributionOutcome>();
  const [shareError, setShareError] = useState<string>();
  const sharingNow = useRef(false);

  async function share() {
    setConsentOpen(false);
    if (sharingNow.current) return;
    if (!capture) { setShareError('Your photo of this scan isn’t on this phone, so it can’t be shared.'); return; }
    sharingNow.current = true;
    setSharing(true);
    setShareError(undefined);
    try {
      setShared(await contributeLabel({ scanId, capture, state: form }));
    } catch (error) {
      setShareError(contributionErrorMessage(error));
    } finally {
      sharingNow.current = false;
      setSharing(false);
    }
  }

  return (
    <>
      <ThemedText type="subtitle">{"Found on the museum's site"}</ThemedText>
      {flow.sourceUrl && <SourceChip label="Museum page" url={flow.sourceUrl} />}
      <VerifiedFieldsForm state={form} warnings={flow.warnings} editable={!saving && !sharing && !shared && !savedId}
        onChange={(name, value) => setForm((current) => setFieldValue(current, name, value))}
        onUnlock={(name) => setForm((current) => unlockField(current, name))} />
      <LabelActions canSave={canSaveLabel(form)} canShare={canShareLabel(form)} saving={saving} sharing={sharing}
        savedId={savedId} shared={shared} saveError={saveError} shareError={shareError}
        onSave={() => { void save({ scanId, capture, draft: {
          title: form.title.value, artist: form.artist.value, date: form.date.value, medium: form.medium.value, institution: '',
        } }); }}
        onShare={() => setConsentOpen(true)}
        onViewSaved={() => router.push({ pathname: '/(tabs)/(collection)/[savedId]', params: { savedId: savedId ?? '' } })} />
      <ConsentSheet open={consentOpen} onShare={() => { void share(); }} onDismiss={() => setConsentOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({ section: { gap: Spacing.three }, progress: { gap: Spacing.one } });
