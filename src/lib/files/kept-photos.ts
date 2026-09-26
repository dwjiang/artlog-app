import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat, type ImageRef } from "expo-image-manipulator";
import { Asset, requestPermissionsAsync } from "expo-media-library";

import { getSetting, setSetting } from "@/db/repos/settings";
import type { ArtworkPhoto } from "@/db/schema";
import { reportError } from "@/lib/observability";
import { getSaveToPhotos } from "@/lib/settings/save-to-photos";

import { captureFileUri } from "./photos";
import { removeFileIfExists } from "./remove-file";

const KEPT_LONG_SIDE = 2560;

export type KeptPhoto = Pick<ArtworkPhoto, "kind"> & { path: string };

/** Writes a smaller JPEG when the photo is over the kept size and `release` lets the original go. */
async function shrink(uri: string, release: () => Promise<boolean>): Promise<string | undefined> {
  const context = ImageManipulator.manipulate(uri);
  let source: ImageRef | undefined;
  let resized: ImageRef | undefined;
  try {
    source = await context.renderAsync();
    const { width, height } = source;
    if (Math.max(width, height) <= KEPT_LONG_SIDE || !(await release())) return undefined;
    const resize = ImageManipulator.manipulate(source);
    try {
      resized = await resize
        .resize(width >= height ? { width: KEPT_LONG_SIDE } : { height: KEPT_LONG_SIDE })
        .renderAsync();
    } finally {
      resize.release();
    }
    return (await resized.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 })).uri;
  } finally {
    resized?.release();
    source?.release();
    context.release();
  }
}

/** The original stays in Photos, so the app stores only the kept size. */
export async function shrinkLibraryPhoto(uri: string): Promise<string> {
  const shrunk = await shrink(uri, async () => true);
  if (!shrunk) return uri;
  new File(uri).delete();
  return shrunk;
}

/** False keeps the original on the phone: Photos failed for a reason other than a declined permission. */
async function addToPhotos(uri: string, receipt: string): Promise<boolean> {
  try {
    if ((await getSetting(receipt)) === "exported") return true;
    const { granted } = await requestPermissionsAsync(true);
    if (granted) {
      await Asset.create(uri);
      // A resize failure or a later launch can retry without exporting this original again.
      await setSetting(receipt, "exported");
    }
    return true;
  } catch (error) {
    reportError(error, "photos.save_original");
    return false;
  }
}

async function keepPhoto({ path, kind }: KeptPhoto): Promise<void> {
  const uri = captureFileUri(path);
  const backup = new File(`${uri}.original`);
  let temporary: File | undefined;
  try {
    const file = new File(uri);
    if (backup.exists) {
      if (file.exists) backup.delete();
      else await new File(backup.uri).move(file);
    }
    if (!file.exists) return;
    const receipt = `kept-photo:${path}`;
    const signature = () => `${file.size}:${file.modificationTime}`;
    if ((await getSetting(receipt)) === signature()) return;
    let released = true;
    const shrunk = await shrink(uri, async () => {
      released = kind === "label" || !(await getSaveToPhotos()) || (await addToPhotos(uri, receipt));
      return released;
    });
    if (!released) return;
    if (!shrunk) {
      await setSetting(receipt, signature());
      return;
    }
    temporary = new File(shrunk);
    // The person may have deleted the photo while it was resizing.
    const target = new File(uri);
    if (target.exists) {
      // File.move(overwrite) removes its destination first. Keep a recoverable original across that gap.
      await target.copy(backup);
      await temporary.move(target, { overwrite: true });
      temporary = undefined;
      backup.delete();
      await setSetting(receipt, signature());
    }
  } catch (error) {
    if (new File(uri).exists || backup.exists) reportError(error, "photos.keep");
    if (backup.exists && !new File(uri).exists) {
      try {
        await new File(backup.uri).move(new File(uri));
      } catch (cause) {
        reportError(cause, "photos.restore_original");
      }
    }
  } finally {
    if (temporary) {
      try {
        removeFileIfExists(temporary);
      } catch (error) {
        reportError(error, "photos.cleanup_resize", { level: "warning" });
      }
    }
  }
}

let queue = Promise.resolve();

// Serialize startup recovery and saves so the same original cannot be exported or replaced concurrently.
export function keepPhotos(photos: KeptPhoto[]): Promise<void> {
  queue = queue.then(async () => {
    for (const photo of photos) await keepPhoto(photo);
  });
  return queue;
}
