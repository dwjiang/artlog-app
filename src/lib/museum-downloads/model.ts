import type { MuseumManifest, MuseumSummary } from '@/shared/offline/types';
import { haversineMeters, type Coordinate } from '@/lib/venue/resolve';

export type MuseumSort = 'nearest' | 'name' | 'size';
export const museumSortLabels: Record<MuseumSort, string> = { nearest: 'Nearest', name: 'Name A–Z', size: 'Download size' };
export type LocalPackage = { manifest: MuseumManifest; folder: string };
export type MuseumDownload = {
  museum: MuseumSummary; status: 'downloading' | 'paused' | 'ready';
  active?: LocalPackage; pending?: LocalPackage; completed: number;
  error?: 'connection' | 'space' | 'unavailable' | 'failed';
};
export function sortMuseums(museums: MuseumSummary[], query: string, sort: MuseumSort, location?: Coordinate): MuseumSummary[] {
  const search = query.trim().normalize('NFKC').toLocaleLowerCase();
  return museums.filter(m => `${m.name} ${m.city ?? ''}`.normalize('NFKC').toLocaleLowerCase().includes(search))
    .sort((a, b) => (sort === 'size' ? a.size - b.size : sort === 'nearest' && location
      ? haversineMeters(location, a) - haversineMeters(location, b) : 0) || a.name.localeCompare(b.name));
}
export function formatDownloadSize(bytes: number): string {
  return bytes < 1_000_000 ? `${Math.max(1, Math.ceil(bytes / 1000))} KB` : `${Math.ceil(bytes / 1_000_000)} MB`;
}
export function downloadProgress(row?: MuseumDownload): number {
  if (!row) return 0;
  if (row.status === 'ready') return 100;
  return row.pending ? Math.min(99, Math.floor(row.completed / Math.max(1, row.pending.manifest.chunks.length) * 100)) : 0;
}
