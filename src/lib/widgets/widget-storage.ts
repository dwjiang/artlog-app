import { Asset } from "expo-asset";
import { digestStringAsync, CryptoDigestAlgorithm } from "expo-crypto";
import { Directory, File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { widgetsDirectory } from "expo-widgets";

import { loadLocalImage } from "@/lib/files/local-image";
import { captureFileUri } from "@/lib/files/photos";
import { removeFileIfExists } from "@/lib/files/remove-file";

import { artlogWidget } from "./artlog-widget";
import type { PreparedWidgetArtwork, WidgetArtwork } from "./widget-collection";
import { widgetPresentation, type WidgetPresentation } from "./widget-layout";
import { widgetRotationSeconds } from "./widget-publisher";
import { defaultWidgetSettings } from "./widget-settings";

function directory() {
  if (!widgetsDirectory) throw new Error("Widget storage is unavailable");
  const folder = new Directory(widgetsDirectory, "artlog");
  folder.create({ intermediates: true, idempotent: true });
  return folder;
}

export async function prepareWidgetArtwork(
  artwork: WidgetArtwork,
  owner: string,
): Promise<PreparedWidgetArtwork | undefined> {
  const folder = directory();
  for (const path of artwork.paths) {
    const source = new File(captureFileUri(path));
    if (!source.exists) continue;
    const key = await digestStringAsync(
      CryptoDigestAlgorithm.SHA256,
      `${owner}\0${path}\0${source.size}\0${source.modificationTime}`,
    );
    const target = new File(folder, `${key}.jpg`);
    const info = new File(folder, `${key}.json`);
    if (target.exists && info.exists) {
      try {
        const aspect: unknown = JSON.parse(info.textSync()).aspect;
        if (typeof aspect === "number" && Number.isFinite(aspect) && aspect > 0) {
          return { ...artwork, uri: target.uri, aspect };
        }
      } catch {
        /* Rebuild incomplete cached metadata from the original photo. */
      }
    }
    let loaded: Awaited<ReturnType<typeof loadLocalImage>> | undefined;
    let context: ReturnType<typeof ImageManipulator.manipulate> | undefined;
    let image: Awaited<ReturnType<ReturnType<typeof ImageManipulator.manipulate>["renderAsync"]>> | undefined;
    try {
      loaded = await loadLocalImage(source.uri, 1024);
      if (!loaded.width || !loaded.height) continue;
      context = ImageManipulator.manipulate(loaded);
      image = await context.renderAsync();
      const result = await image.saveAsync({
        format: SaveFormat.JPEG,
        compress: 0.9,
      });
      removeFileIfExists(target);
      await new File(result.uri).move(target);
      const aspect = loaded.width / loaded.height;
      info.writeSync(JSON.stringify({ aspect }));
      return { ...artwork, uri: target.uri, aspect };
    } catch {
      /* A damaged or unavailable photo must not block the remaining collection. */
    } finally {
      image?.release();
      context?.release();
      loaded?.release();
    }
  }
}

let fontCopy: Promise<void> | undefined;

/** The Home Screen widget and the visit Live Activity both ask at launch; they share one copy so neither overwrites. */
export function prepareWidgetFont(): Promise<void> {
  fontCopy ??= copyWidgetFont().catch((error: unknown) => {
    fontCopy = undefined;
    throw error;
  });
  return fontCopy;
}

async function copyWidgetFont() {
  const font = new File(directory(), "space-grotesk-semibold.ttf");
  if (font.exists) return;
  const asset = await Asset.fromModule(require("../../../assets/fonts/space-grotesk-semibold.ttf")).downloadAsync();
  if (!asset.localUri) throw new Error("Widget font is unavailable");
  await new File(asset.localUri).copy(font);
}

export function writeWidgetManifest(entries: WidgetPresentation[]) {
  const manifest = new File(directory(), "collection.json");
  manifest.writeSync(JSON.stringify({ interval: widgetRotationSeconds, entries }));
  artlogWidget.reload();
}

export function pruneWidgetImages(artworks: PreparedWidgetArtwork[]) {
  const keep = new Set(artworks.flatMap((artwork) => [artwork.uri, artwork.uri.replace(/\.jpg$/, ".json")]));
  for (const file of directory().list()) {
    if (file instanceof File && /^[a-f0-9]{64}\.(jpg|json)$/.test(file.name) && !keep.has(file.uri)) {
      file.delete();
    }
  }
}

// 44 pt at 3x, the largest the visit Live Activity draws them.
const VISIT_THUMBNAIL_PIXELS = 132;
const VISIT_THUMBNAIL_NAME = /^visit-[a-f0-9]{64}\.jpg$/;

/** Square, center-cropped copies of visit photos in the shared directory, the only place the Live Activity can read. */
export async function prepareVisitThumbnails(paths: string[]): Promise<string[]> {
  const folder = directory();
  const uris: string[] = [];
  for (const path of paths) {
    const source = new File(captureFileUri(path));
    if (!source.exists) continue;
    const key = await digestStringAsync(
      CryptoDigestAlgorithm.SHA256,
      `${path}\0${source.size}\0${source.modificationTime}`,
    );
    const target = new File(folder, `visit-${key}.jpg`);
    if (!target.exists) {
      let loaded: Awaited<ReturnType<typeof loadLocalImage>> | undefined;
      let context: ReturnType<typeof ImageManipulator.manipulate> | undefined;
      let image: Awaited<ReturnType<ReturnType<typeof ImageManipulator.manipulate>["renderAsync"]>> | undefined;
      try {
        loaded = await loadLocalImage(source.uri, VISIT_THUMBNAIL_PIXELS * 4);
        const side = Math.min(loaded.width, loaded.height);
        context = ImageManipulator.manipulate(loaded)
          .crop({
            originX: Math.floor((loaded.width - side) / 2),
            originY: Math.floor((loaded.height - side) / 2),
            width: side,
            height: side,
          })
          .resize({ width: VISIT_THUMBNAIL_PIXELS, height: VISIT_THUMBNAIL_PIXELS });
        image = await context.renderAsync();
        const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
        await new File(result.uri).move(target);
      } catch {
        /* A damaged or unavailable photo leaves its slot to the next one. */
        continue;
      } finally {
        image?.release();
        context?.release();
        loaded?.release();
      }
    }
    uris.push(target.uri);
  }
  return uris;
}

export function pruneVisitThumbnails(keep: string[]) {
  const kept = new Set(keep);
  for (const file of directory().list()) {
    if (file instanceof File && VISIT_THUMBNAIL_NAME.test(file.name) && !kept.has(file.uri)) file.delete();
  }
}

export function clearWidgetCollection() {
  writeWidgetManifest([widgetPresentation(undefined, defaultWidgetSettings)]);
  pruneWidgetImages([]);
}
