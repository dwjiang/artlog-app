import { customType, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type { Id } from '../../convex/_generated/dataModel';

/** Binary features keep the `ArrayBuffer` shape of the Convex `v.bytes()` arguments they are sent as. */
const bytes = customType<{ data: ArrayBuffer; driverData: Uint8Array }>({
  dataType: () => 'blob',
  toDriver: (value) => new Uint8Array(value),
  fromDriver: (value) => {
    const copy = new Uint8Array(value.byteLength);
    copy.set(value);
    return copy.buffer;
  },
});

// File columns are relative to Paths.document; src/lib/files/photos.ts resolves their current URIs.

export const visits = sqliteTable('visits', {
  localId: text().primaryKey(),
  venueId: text().$type<Id<'museums'>>().notNull(),
  venueName: text().notNull(),
  startedAt: integer().notNull(),
  endedAt: integer(),
  remoteVisitId: text().$type<Id<'visits'>>(),
  endSyncedAt: integer(),
});

/** An immutable snapshot of what the user saw (design §4.2 *Moves*): only notes, deletion and sync state change. */
export const savedWorks = sqliteTable(
  'savedWorks',
  {
    localId: text().primaryKey(),
    visitLocalId: text().references(() => visits.localId),
    venueId: text().$type<Id<'museums'>>(),
    venueName: text(),
    gallery: text(),
    savedAt: integer().notNull(),
    title: text().notNull(),
    artist: text().notNull(),
    date: text(),
    medium: text(),
    institution: text(),
    objectId: text().$type<Id<'objects'>>(),
    artworkId: text().$type<Id<'artworks'>>(),
    scanId: text().$type<Id<'scans'>>(),
    photoPath: text(),
    cropPath: text(),
    syncedAt: integer(),
    revision: integer().notNull().default(0),
    syncedBy: text().$type<Id<'devices'>>(),
    deletedAt: integer(),
  },
  (table) => [index('savedWorks_savedAt').on(table.savedAt)],
);

export const notes = sqliteTable('notes', {
  savedLocalId: text().primaryKey().references(() => savedWorks.localId),
  text: text().notNull(),
  updatedAt: integer().notNull(),
});

export const pendingScanStatuses = ['queued', 'identifying', 'identified', 'failed'] as const;
export type PendingScanStatus = (typeof pendingScanStatuses)[number];

/** Every capture, sent or queued: the crop, vector and features stay here until the scan is saved or dismissed. */
export const pendingScans = sqliteTable(
  'pendingScans',
  {
    localId: text().primaryKey(),
    photoPath: text().notNull(),
    cropPath: text().notNull(),
    vector: text({ mode: 'json' }).$type<number[]>().notNull(),
    descriptors: bytes().notNull(),
    keypoints: bytes().notNull(),
    modelVersion: text().notNull(),
    venueId: text().$type<Id<'museums'>>(),
    visitId: text().$type<Id<'visits'>>(),
    visitLocalId: text().references(() => visits.localId),
    capturedAt: integer().notNull(),
    labelPhotoPath: text(),
    qrUrl: text(),
    status: text({ enum: pendingScanStatuses }).notNull().default('queued'),
    // The retry budget can belong to a newer model even when re-embedding has not succeeded.
    attemptModelVersion: text().notNull(),
    attempts: integer().notNull().default(0),
    lastError: text(),
    scanId: text().$type<Id<'scans'>>(),
    createdAt: integer().notNull(),
    reviewedAt: integer(),
  },
  (table) => [index('pendingScans_status_capturedAt').on(table.status, table.capturedAt)],
);

export const settings = sqliteTable('settings', {
  key: text().primaryKey(),
  value: text().notNull(),
});

export type Visit = typeof visits.$inferSelect;
export type NewVisit = typeof visits.$inferInsert;
export type SavedWork = typeof savedWorks.$inferSelect;
export type NewSavedWork = typeof savedWorks.$inferInsert;
export type Note = typeof notes.$inferSelect;
export type PendingScan = typeof pendingScans.$inferSelect;
export type NewPendingScan = typeof pendingScans.$inferInsert;
