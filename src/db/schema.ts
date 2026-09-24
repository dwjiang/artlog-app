import {
  customType,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import type { OfflineResult } from "../../shared/offline/types";
import type { Id } from "../../convex/_generated/dataModel";

/** Binary features keep the `ArrayBuffer` shape of the Convex `v.bytes()` arguments they are sent as. */
const bytes = customType<{ data: ArrayBuffer; driverData: Uint8Array }>({
  dataType: () => "blob",
  toDriver: (value) => new Uint8Array(value),
  fromDriver: (value) => {
    const copy = new Uint8Array(value.byteLength);
    copy.set(value);
    return copy.buffer;
  },
});

// File columns are relative to Paths.document; src/lib/files/photos.ts resolves their current URIs.

export const visits = sqliteTable(
  "visits",
  {
    visibility: text("visibility", { enum: ["public", "private"] })
      .notNull()
      .default("public"),
    owner: text().notNull(),
    localId: text().notNull(),
    venueId: text().$type<Id<"museums">>().notNull(),
    venueName: text().notNull(),
    visitedOn: text().notNull(),
    timeZone: text().notNull(),
    reflection: text(),
    startedAt: integer(),
    endedAt: integer(),
    remoteVisitId: text().$type<Id<"visits">>(),
    syncedAt: integer(),
    syncedBy: text().$type<Id<"devices">>(),
    revision: integer().notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.owner, table.localId] }),
    index("visits_owner_history").on(
      table.owner,
      table.visitedOn,
      table.localId,
    ),
  ],
);

/** A saved artwork and its private collection preview. */
export const savedWorks = sqliteTable(
  "savedWorks",
  {
    owner: text().notNull(),
    localId: text().notNull(),
    visitLocalId: text(),
    venueId: text().$type<Id<"museums">>(),
    venueName: text(),
    gallery: text(),
    savedAt: integer().notNull(),
    title: text().notNull(),
    artist: text().notNull(),
    date: text(),
    medium: text(),
    institution: text(),
    objectId: text().$type<Id<"objects">>(),
    artworkId: text().$type<Id<"artworks">>(),
    scanId: text().$type<Id<"scans">>(),
    photoPath: text(),
    cropPath: text(),
    cropStorageId: text().$type<Id<"_storage">>(),
    photoUpdatedAt: integer().notNull().default(0),
    syncedAt: integer(),
    revision: integer().notNull().default(0),
    syncedBy: text().$type<Id<"devices">>(),
    deletedAt: integer(),
  },
  (table) => [
    primaryKey({ columns: [table.owner, table.localId] }),
    foreignKey({
      columns: [table.owner, table.visitLocalId],
      foreignColumns: [visits.owner, visits.localId],
    }).onUpdate("cascade"),
    index("savedWorks_owner_savedAt").on(table.owner, table.savedAt),
  ],
);

export const notes = sqliteTable(
  "notes",
  {
    owner: text().notNull(),
    savedLocalId: text().notNull(),
    text: text().notNull(),
    updatedAt: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.owner, table.savedLocalId] }),
    foreignKey({
      columns: [table.owner, table.savedLocalId],
      foreignColumns: [savedWorks.owner, savedWorks.localId],
    }).onUpdate("cascade"),
  ],
);

export const artworkPhotos = sqliteTable(
  "artworkPhotos",
  {
    owner: text().notNull(),
    localId: text().notNull(),
    savedLocalId: text().notNull(),
    kind: text({ enum: ["full", "detail", "label"] }).notNull(),
    capturedAt: integer().notNull(),
    visitLocalId: text(),
    caption: text(),
    path: text(),
    storageId: text().$type<Id<"_storage">>(),
    deletedAt: integer(),
    syncedAt: integer(),
    revision: integer().notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.owner, table.localId] }),
    foreignKey({
      columns: [table.owner, table.savedLocalId],
      foreignColumns: [savedWorks.owner, savedWorks.localId],
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
    index("artworkPhotos_owner_work").on(table.owner, table.savedLocalId),
  ],
);

export const artworkEncounters = sqliteTable(
  "artworkEncounters",
  {
    owner: text().notNull(),
    savedLocalId: text().notNull(),
    visitLocalId: text().notNull(),
    note: text(),
    deletedAt: integer(),
    syncedAt: integer(),
    revision: integer().notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [table.owner, table.savedLocalId, table.visitLocalId],
    }),
    foreignKey({
      columns: [table.owner, table.savedLocalId],
      foreignColumns: [savedWorks.owner, savedWorks.localId],
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
    index("artworkEncounters_owner_visit").on(table.owner, table.visitLocalId),
  ],
);

export type ArtworkPhoto = typeof artworkPhotos.$inferSelect;
export type ArtworkEncounter = typeof artworkEncounters.$inferSelect;

export const pendingScanStatuses = [
  "queued",
  "identifying",
  "identified",
  "failed",
] as const;
export type PendingScanStatus = (typeof pendingScanStatuses)[number];

/** Every capture, sent or queued: the crop, vector and features stay here until the scan is saved or dismissed. */
export const pendingScans = sqliteTable(
  "pendingScans",
  {
    owner: text().notNull(),
    localId: text().notNull(),
    photoPath: text().notNull(),
    cropPath: text().notNull(),
    vector: text({ mode: "json" }).$type<number[]>().notNull(),
    descriptors: bytes().notNull(),
    keypoints: bytes().notNull(),
    modelVersion: text().notNull(),
    venueId: text().$type<Id<"museums">>(),
    visitId: text().$type<Id<"visits">>(),
    visitLocalId: text(),
    capturedAt: integer().notNull(),
    labelPhotoPath: text(),
    qrUrl: text(),
    status: text({ enum: pendingScanStatuses }).notNull().default("queued"),
    // The retry budget can belong to a newer model even when re-embedding has not succeeded.
    attemptModelVersion: text().notNull(),
    attempts: integer().notNull().default(0),
    lastError: text(),
    scanId: text().$type<Id<"scans">>(),
    createdAt: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.owner, table.localId] }),
    foreignKey({
      columns: [table.owner, table.visitLocalId],
      foreignColumns: [visits.owner, visits.localId],
    }).onUpdate("cascade"),
    index("pendingScans_owner_status_capturedAt").on(
      table.owner,
      table.status,
      table.capturedAt,
    ),
  ],
);

export const offlineScanResults = sqliteTable(
  "offlineScanResults",
  {
    owner: text().notNull(),
    localId: text().notNull(),
    result: text({ mode: "json" }).$type<OfflineResult>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.owner, table.localId] }),
    foreignKey({
      columns: [table.owner, table.localId],
      foreignColumns: [pendingScans.owner, pendingScans.localId],
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
  ],
);

export const settings = sqliteTable("settings", {
  key: text().primaryKey(),
  value: text().notNull(),
});

export type Visit = typeof visits.$inferSelect;
export type NewVisit = Omit<typeof visits.$inferInsert, "owner"> & {
  owner?: string;
};
export type SavedWork = typeof savedWorks.$inferSelect;
export type NewSavedWork = Omit<typeof savedWorks.$inferInsert, "owner"> & {
  owner?: string;
};
export type Note = typeof notes.$inferSelect;
export type PendingScan = typeof pendingScans.$inferSelect;
export type NewPendingScan = Omit<typeof pendingScans.$inferInsert, "owner"> & {
  owner?: string;
};
