import { Image } from 'expo-image';
import { ImageManipulator } from 'expo-image-manipulator';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getVisionRect } from '../../../modules/vision-rect/src';
import { GalleryButton } from '@/components/collection/gallery-button';
import { ThemedText as Text } from '@/components/themed-text';
import { Gallery } from '@/constants/theme';
import { wholePhoto } from '@/lib/capture/crop-geometry';
import { discardEditedCrop, prepareEditedCrop, type EditedCrop } from '@/lib/capture/edit-crop';
import { selectCaptureQuad } from '@/lib/capture/rectangle';
import type { Quad } from '@/lib/capture/stages';
import { captureFileUri } from '@/lib/files/photos';
import { filePath } from '@/lib/file-uri';
import { CropCorners } from './crop-corners';

export function CropEditor({ photoPath, saveLabel = 'Save crop', onSave, onCancel }: {
  photoPath: string; saveLabel?: string; onSave: (crop: EditedCrop, isCurrent: () => boolean) => Promise<void>; onCancel: () => void;
}) {
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [corners, setCorners] = useState<Quad>(wholePhoto);
  const [preview, setPreview] = useState<EditedCrop>();
  const [busy, setBusy] = useState<'loading' | 'preview' | 'saving' | undefined>('loading');
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const active = useRef(false), working = useRef(false), retained = useRef<EditedCrop | undefined>(undefined);
  const insets = useSafeAreaInsets();
  const uri = captureFileUri(photoPath);
  useEffect(() => {
    active.current = true;
    let cancelled = false;
    const context = ImageManipulator.manipulate(uri);
    void (async () => {
      let photo;
      try {
        photo = await context.renderAsync();
        const detected = await getVisionRect().detectStill(filePath(uri)).catch(() => undefined);
        if (cancelled) return;
        setSize({ width: photo.width, height: photo.height });
        setCorners(detected ? selectCaptureQuad(null, detected) ?? wholePhoto : wholePhoto);
        setBusy(undefined);
      } catch {
        if (!cancelled) { setError('Couldn’t open the full photo. Try again once it is on this iPhone.'); setBusy(undefined); }
      } finally { photo?.release(); context.release(); }
    })();
    return () => {
      cancelled = true; active.current = false;
      if (retained.current) { discardEditedCrop(retained.current); retained.current = undefined; }
    };
  }, [uri, attempt]);

  async function showPreview() {
    if (working.current) return;
    working.current = true; setBusy('preview'); setError(undefined);
    try {
      const crop = await prepareEditedCrop(photoPath, corners);
      if (!active.current) { discardEditedCrop(crop); return; }
      retained.current = crop; setPreview(crop);
    } catch { if (active.current) setError('Couldn’t prepare this crop. Adjust the corners and try again.'); }
    finally { working.current = false; if (active.current) setBusy(undefined); }
  }
  function adjust() {
    if (retained.current) discardEditedCrop(retained.current);
    retained.current = undefined; setPreview(undefined); setError(undefined);
  }
  async function save() {
    if (!preview || working.current) return;
    working.current = true; setBusy('saving'); setError(undefined);
    try { await onSave(preview, () => active.current); }
    catch { if (active.current) setError('Couldn’t save this crop. Your previous crop is still available. Try again.'); }
    finally { working.current = false; if (active.current) setBusy(undefined); }
  }
  return <View style={[styles.screen, { paddingBottom: Math.max(insets.bottom, 16) }]}>
    <Text style={styles.instructions}>{preview ? 'Check the painting before saving.' : 'Drag each corner onto the painting’s corners.'}</Text>
    {preview ? <View style={styles.preview}><Image source={preview.previewUri} contentFit="contain" style={StyleSheet.absoluteFill} accessibilityLabel="Corrected painting preview" /></View>
      : size ? <CropCorners uri={uri} size={size} corners={corners} onChange={setCorners} />
      : <View style={styles.loading}><Text>{busy === 'loading' ? 'Opening full photo…' : 'Full photo unavailable'}</Text></View>}
    <ScrollView style={{ flexGrow: 0, maxHeight: '45%' }} contentContainerStyle={styles.controls}>
      {error && <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>{error}</Text>}
      {preview ? <>
        <GalleryButton label={saveLabel} variant="filled" fullWidth busy={busy === 'saving'} busyLabel="Saving crop…" onPress={() => { void save(); }} />
        <GalleryButton label="Adjust corners" disabled={!!busy} onPress={adjust} />
      </> : size ? <>
        <GalleryButton label="Preview crop" variant="filled" fullWidth busy={busy === 'preview'} busyLabel="Preparing preview…" onPress={() => { void showPreview(); }} />
        <GalleryButton label="Use whole photo" disabled={!!busy} onPress={() => { setCorners(wholePhoto); setError(undefined); }} />
      </> : !busy ? <GalleryButton label="Retry" onPress={() => { setError(undefined); setBusy('loading'); setAttempt((value) => value + 1); }} /> : null}
      <GalleryButton label="Cancel" disabled={busy === 'saving'} onPress={onCancel} />
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Gallery.paper },
  instructions: { paddingHorizontal: 24, paddingTop: 16, color: Gallery.muted },
  preview: { flex: 1, minHeight: 180, margin: 24, backgroundColor: Gallery.fill },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  controls: { paddingHorizontal: 24, gap: 4 },
});
