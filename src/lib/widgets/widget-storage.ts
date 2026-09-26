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
      info.write(JSON.stringify({ aspect }));
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

export async function prepareWidgetFont() {
  const font = new File(directory(), "anton-regular.ttf");
  if (font.exists) return;
  const asset = await Asset.fromModule(require("../../../assets/fonts/anton-regular.ttf")).downloadAsync();
  if (!asset.localUri) throw new Error("Widget font is unavailable");
  await new File(asset.localUri).copy(font);
}

export function writeWidgetManifest(entries: WidgetPresentation[]) {
  const manifest = new File(directory(), "collection.json");
  manifest.write(JSON.stringify({ interval: widgetRotationSeconds, entries }));
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

export function clearWidgetCollection() {
  writeWidgetManifest([widgetPresentation(undefined, defaultWidgetSettings)]);
  pruneWidgetImages([]);
}
