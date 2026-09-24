import type { ImageRef } from "expo-image-manipulator";

import { loadLocalImage } from "@/lib/files/local-image";
import { reportError } from "@/lib/observability";

export const PRESENTATION_LOAD_TIMEOUT_MS = 1500;

export class PresentationImages {
  private released = false;
  private images = new Set<ImageRef>();

  async load(uri: string): Promise<ImageRef | undefined> {
    if (this.released) return;
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loading = Promise.resolve()
      .then(() => loadLocalImage(uri, 2048))
      .then((image) => {
        if (this.released || expired) {
          image.release();
          return;
        }
        this.images.add(image);
        return image;
      })
      .catch((error: unknown) => {
        if (!this.released && !expired) {
          reportError(error, "capture.load_presentation", { level: "warning" });
        }
        return undefined;
      });
    try {
      return await Promise.race([
        loading,
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => {
            expired = true;
            resolve(undefined);
          }, PRESENTATION_LOAD_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  release() {
    this.released = true;
    this.images.forEach((image) => image.release());
    this.images.clear();
  }
}
