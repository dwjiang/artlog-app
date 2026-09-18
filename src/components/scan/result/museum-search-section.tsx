import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Id } from '../../../../convex/_generated/dataModel';
import type { LabelFlowDisplay } from '../../../../convex/lib/validators';
import { CapturePhotosButton } from '../capture-photos-button';
import { ConsentSheet } from '../label/consent-sheet';
import { LabelActions } from '../label/label-actions';
import { VerifiedFieldsForm } from '../label/verified-fields-form';
import { SearchConsentSheet } from './search-consent-sheet';
import { SourceChip } from './source-chip';
import { GalleryButton } from '@/components/collection/gallery-button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { PendingScan } from '@/db/schema';
import { contributeLabel, contributionErrorMessage, type ContributionOutcome } from '@/lib/label/contribute';
import { canSaveLabel, canShareLabel, setFieldValue, unlockField } from '@/lib/label/fields';
import { useLabelForm } from '@/lib/label/use-label-form';
import type { MuseumSearchStage } from '@/lib/museum-search/flow';
import type { MuseumSearchController } from '@/lib/museum-search/use-museum-search';
import { useSaveResult } from '@/lib/result/use-save-result';

export const MUSEUM_SEARCH_BUTTON = "Search this museum's collection";
const STAGE_TEXT: Record<MuseumSearchStage, string> = {
  exhibitions: 'Looking up current exhibitions',
  describe: 'Preparing your photo', search: 'Describing the painting and searching the site',
  check: 'Comparing the museum’s images on your phone', done: 'Image confirmed', none: 'Search finished',
};

type Props = { search: MuseumSearchController; scanId: Id<'scans'>; capture?: PendingScan };

export function MuseumSearchSection({ search, scanId, capture }: Props) {
  if (!search.visible) return null;
  if (search.restoring || search.restoreError) return (
    <View style={styles.section}>
      <ThemedText>{search.restoreError ? 'Couldn’t load your museum result. Try again.' : 'Loading museum result…'}</ThemedText>
      {search.restoreError && <GalleryButton label="Try again" variant="outlined" onPress={search.retryRestore} />}
    </View>
  );
  return (
    <View style={styles.section}>
      {search.flow && search.confirmedAt !== undefined ? (
        <MuseumSearchResult key={`${scanId}:${search.confirmedAt}`} flow={search.flow} confirmedAt={search.confirmedAt} scanId={scanId} capture={capture} />
      ) : (
        <>
          <GalleryButton label={MUSEUM_SEARCH_BUTTON} variant="outlined" fullWidth busy={search.running} disabled={!search.canSearch || search.running} onPress={search.requestSearch} />
          {search.running ? (
            <View accessibilityLiveRegion="polite" accessibilityState={{ busy: true }} style={styles.progress}>
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

function MuseumSearchResult({ flow, confirmedAt, scanId, capture }: { flow: LabelFlowDisplay; confirmedAt: number; scanId: Id<'scans'>; capture?: PendingScan }) {
  const router = useRouter();
  const { form, setForm, error: formError, retry: retryForm } = useLabelForm(scanId, flow, confirmedAt);
  const { saving, savedId, completion, error: saveError, save } = useSaveResult();
  const [consentOpen, setConsentOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState<ContributionOutcome>();
  const [shareError, setShareError] = useState<string>();
  const sharingNow = useRef(false);

  async function share() {
    setConsentOpen(false);
    if (!form || sharingNow.current) return;
    if (!capture) { setShareError('Your photo of this scan isn’t on this phone, so it can’t be shared.'); return; }
    sharingNow.current = true;
    setSharing(true);
    setShareError(undefined);
    try {
      setShared(await contributeLabel({ scanId, capture, state: form, museumSearchUpdatedAt: confirmedAt }));
    } catch (error) {
      setShareError(contributionErrorMessage(error));
    } finally {
      sharingNow.current = false;
      setSharing(false);
    }
  }

  if (!form) return (
    <View style={styles.section}>
      <ThemedText>{formError?.message ?? 'Loading your edits…'}</ThemedText>
      {formError && <GalleryButton label="Try again" variant="outlined" onPress={retryForm} />}
    </View>
  );

  return (
    <>
      <ThemedText type="subtitle">{"Found on the museum's site"}</ThemedText>
      {flow.sourceUrl && <SourceChip label="Museum page" url={flow.sourceUrl} />}
      <VerifiedFieldsForm state={form} warnings={flow.warnings} editable={!saving && !sharing && !shared && !savedId}
        onChange={(name, value) => setForm((current) => current && setFieldValue(current, name, value))}
        onUnlock={(name) => setForm((current) => current && unlockField(current, name))} />
      {capture && !savedId && <CapturePhotosButton disabled={saving} input={{ scanId, capture, draft: { title: form.title.value, artist: form.artist.value, date: form.date.value, medium: form.medium.value, institution: '' } }} />}
      <LabelActions canSave={canSaveLabel(form)} canShare={canShareLabel(form)} saving={saving} sharing={sharing}
        savedId={savedId} completion={completion} shared={shared} saveError={saveError} shareError={shareError}
        onSave={() => { void save({ scanId, capture, draft: {
          title: form.title.value, artist: form.artist.value, date: form.date.value, medium: form.medium.value, institution: '',
        } }); }}
        onShare={() => setConsentOpen(true)}
        onViewSaved={() => router.push({ pathname: '/saved/[savedId]', params: { savedId: savedId ?? '' } })} />
      <ConsentSheet open={consentOpen} onShare={() => { void share(); }} onDismiss={() => setConsentOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({ section: { gap: Spacing.three }, progress: { gap: Spacing.one } });
