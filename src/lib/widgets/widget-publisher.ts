import type { PreparedWidgetArtwork, WidgetArtwork } from "./widget-collection";
import { widgetPresentation, type WidgetPresentation } from "./widget-layout";
import type { WidgetSettings } from "./widget-settings";

export const widgetRotationSeconds = 6 * 60 * 60;
export function currentWidgetIndex(count: number, now = Date.now()): number {
  return count ? Math.floor(now / (widgetRotationSeconds * 1000)) % count : 0;
}

export function createWidgetPublisher(dependencies: {
  prepare: (artwork: WidgetArtwork, owner: string) => Promise<PreparedWidgetArtwork | undefined>;
  write: (entries: WidgetPresentation[]) => void;
  prune: (artworks: PreparedWidgetArtwork[]) => void;
  currentOwner: () => string;
}) {
  let generation = 0;
  return {
    cancel() {
      generation++;
    },
    async publish(
      owner: string,
      artworks: WidgetArtwork[],
      settings: WidgetSettings,
    ): Promise<PreparedWidgetArtwork[] | undefined> {
      const version = ++generation;
      const current = () => generation === version && owner === dependencies.currentOwner();
      const ready: PreparedWidgetArtwork[] = [];
      for (const artwork of artworks) {
        if (!current()) return;
        const prepared = await dependencies.prepare(artwork, owner);
        if (!current()) return;
        if (prepared) ready.push(prepared);
      }
      if (!current()) return;
      dependencies.write(
        ready.length
          ? ready.map((artwork) => widgetPresentation(artwork, settings))
          : [widgetPresentation(undefined, settings)],
      );
      dependencies.prune(ready);
      return ready;
    },
  };
}
