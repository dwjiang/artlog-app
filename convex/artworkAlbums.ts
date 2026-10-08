import { ConvexError, v } from "convex/values";

import { albumEncounter, albumPhoto, validateAlbumEncounter, validateAlbumPhoto } from "../shared/collection/album";
import { isRevision, LIMITS, utf8Bytes } from "../shared/journal/limits";
import { mutation } from "./functions";
import { invalidateAlbumPhoto } from "./lib/albumMedia";
import { deleteUnreferencedPhoto } from "./lib/collectionPhotos";
import { recordArtworkScore } from "./lib/leaderboard";
import { findOwnedSave, findOwnedVisit, nextChangeVersion, requireJournalOwner } from "./lib/ownership";
import { invalidateDeletedSave } from "./lib/publicationAccess";
import { advancePublicationRevision } from "./lib/publicationUpdates";
import { limitDevice } from "./lib/rateLimits";
import { mergeSavedRecognition } from "./lib/savedRecognition";
import schema from "./schema";

export const sync = mutation({
  args: {
    scope: v.string(),
    since: v.number(),
    photos: v.array(albumPhoto),
    encounters: v.array(albumEncounter),
  },
  returns: v.object({
    photos: v.array(schema.doc("artworkPhotos")),
    encounters: v.array(schema.doc("artworkEncounters")),
    checkpoint: v.number(),
    hasMore: v.boolean(),
    saves: v.array(schema.doc("collections")),
    visits: v.array(schema.doc("visits")),
  }),
  handler: async (ctx, args) => {
    const { owner, device } = await requireJournalOwner(ctx, args.scope);
    await limitDevice(ctx, "sync", device._id);
    if (
      !isRevision(args.since)
      || args.photos.length + args.encounters.length > 50
      || utf8Bytes(args) > LIMITS.batchBytes
    ) {
      throw new ConvexError({ code: "invalid_sync" });
    }
    for (const input of args.photos) {
      validateAlbumPhoto(input);
      const save = await findOwnedSave(ctx, owner, input.savedLocalId);
      if (!save) throw new ConvexError({ code: "not_found" });
      if (input.visitLocalId && !(await findOwnedVisit(ctx, owner, input.visitLocalId))) {
        throw new ConvexError({ code: "not_found" });
      }
      const existing = await ctx.db
        .query("artworkPhotos")
        .withIndex("by_owner_localId", (q) => q.eq("owner", owner).eq("localId", input.localId))
        .unique();
      if (existing && existing.capturedAt !== input.capturedAt) {
        throw new ConvexError({ code: "invalid_photo" });
      }
      if (existing?.deletedAt !== undefined) continue;
      const deletedAt = save.deletedAt ?? input.deletedAt;
      if (
        existing
        && existing.saveId === save._id
        && existing.visitLocalId === input.visitLocalId
        && existing.kind === input.kind
        && existing.caption === input.caption
        && existing.deletedAt === deletedAt
      ) {
        continue;
      }
      if (
        deletedAt === undefined
        && (!existing || existing.saveId !== save._id)
        && (
          await ctx.db
            .query("artworkPhotos")
            .withIndex("by_save_deletedAt", (q) => q.eq("saveId", save._id).eq("deletedAt", undefined))
            .take(100)
        ).length >= 100
      ) {
        throw new ConvexError({ code: "album_full" });
      }
      const fields = {
        ...input,
        // The first visit assignment wins, including over stale offline edits that still carry no visit.
        visitLocalId: existing?.visitLocalId ?? input.visitLocalId,
        caption: input.caption,
        deletedAt,
        owner,
        saveId: save._id,
        updatedAt: Date.now(),
        changeVersion: await nextChangeVersion(ctx, owner),
      };
      if (existing) {
        await ctx.db.patch("artworkPhotos", existing._id, fields);
        if (deletedAt !== undefined || existing.saveId !== save._id) {
          await invalidateAlbumPhoto(ctx, existing);
        }
        if (deletedAt !== undefined && existing.storageId) {
          await deleteUnreferencedPhoto(ctx, existing.storageId);
        }
      } else {
        await ctx.db.insert("artworkPhotos", fields);
      }
    }
    for (const { note: _note, ...input } of args.encounters) {
      validateAlbumEncounter(input);
      const save = await findOwnedSave(ctx, owner, input.savedLocalId);
      const visit = await findOwnedVisit(ctx, owner, input.visitLocalId);
      if (!save || !visit) throw new ConvexError({ code: "not_found" });
      const existing = await ctx.db
        .query("artworkEncounters")
        .withIndex("by_save_visit", (q) => q.eq("saveId", save._id).eq("visitId", visit._id))
        .unique();
      const deletedAt = save.deletedAt ?? input.deletedAt;
      if (existing && existing.deletedAt === deletedAt) {
        continue;
      }
      if (
        deletedAt === undefined
        && (!existing || existing.deletedAt !== undefined)
        && (
          await ctx.db
            .query("artworkEncounters")
            .withIndex("by_save_deletedAt", (q) => q.eq("saveId", save._id).eq("deletedAt", undefined))
            .take(100)
        ).length >= 100
      ) {
        throw new ConvexError({ code: "album_full" });
      }
      const fields = {
        ...input,
        deletedAt,
        owner,
        saveId: save._id,
        visitId: visit._id,
        updatedAt: Date.now(),
        changeVersion: await nextChangeVersion(ctx, owner),
      };
      if (existing) await ctx.db.patch("artworkEncounters", existing._id, fields);
      else await ctx.db.insert("artworkEncounters", fields);
      if (deletedAt !== undefined) {
        const publication = await ctx.db
          .query("sharedVisits")
          .withIndex("by_visitId", (q) => q.eq("visitId", visit._id))
          .unique();
        if (publication) {
          const items = await ctx.db
            .query("sharedVisitItems")
            .withIndex("by_saveId", (q) => q.eq("saveId", save._id))
            .take(101);
          for (const item of items) {
            if (item.publicationId === publication._id) {
              await ctx.db.delete("sharedVisitItems", item._id);
            }
          }
          await advancePublicationRevision(ctx, publication);
        }
      }
    }
    const photos = await ctx.db
      .query("artworkPhotos")
      .withIndex("by_owner_changeVersion", (q) => q.eq("owner", owner).gt("changeVersion", args.since))
      .take(51);
    const encounters = await ctx.db
      .query("artworkEncounters")
      .withIndex("by_owner_changeVersion", (q) => q.eq("owner", owner).gt("changeVersion", args.since))
      .take(51);
    const changes = [...photos, ...encounters].sort((a, b) => a.changeVersion - b.changeVersion).slice(0, 50);
    const checkpoint = changes.at(-1)?.changeVersion ?? args.since;
    const selectedPhotos = photos.filter((row) => row.changeVersion <= checkpoint);
    const selectedEncounters = encounters.filter((row) => row.changeVersion <= checkpoint);
    const saves = await Promise.all(
      [...new Set([...selectedPhotos, ...selectedEncounters].map((row) => row.saveId))].map((id) =>
        ctx.db.get("collections", id),
      ),
    );
    const visitIds = [
      ...new Set([
        ...selectedEncounters.map((row) => row.visitId),
        ...saves.flatMap((row) => (row?.visitId ? [row.visitId] : [])),
      ]),
    ];
    const visits = await Promise.all(visitIds.map((id) => ctx.db.get("visits", id)));
    for (const row of selectedPhotos) {
      if (row.visitLocalId && !visits.some((visit) => visit?.localId === row.visitLocalId)) {
        visits.push(await findOwnedVisit(ctx, owner, row.visitLocalId));
      }
    }
    return {
      saves: saves.filter((row) => row !== null),
      visits: visits.filter((row) => row !== null),
      photos: photos.filter((row) => row.changeVersion <= checkpoint),
      encounters: encounters.filter((row) => row.changeVersion <= checkpoint),
      checkpoint,
      hasMore: photos.length + encounters.length > changes.length,
    };
  },
});

export const merge = mutation({
  args: {
    scope: v.string(),
    sourceLocalId: v.string(),
    targetLocalId: v.string(),
  },
  returns: v.object({
    saves: v.array(schema.doc("collections")),
    photos: v.array(schema.doc("artworkPhotos")),
    encounters: v.array(schema.doc("artworkEncounters")),
  }),
  handler: async (ctx, args) => {
    const { owner, device } = await requireJournalOwner(ctx, args.scope);
    const source = await findOwnedSave(ctx, owner, args.sourceLocalId);
    const target = await findOwnedSave(ctx, owner, args.targetLocalId);
    if (!source || !target || source._id === target._id || target.deletedAt !== undefined) {
      throw new ConvexError({ code: "not_found" });
    }
    const targetPhotos = await ctx.db
      .query("artworkPhotos")
      .withIndex("by_save_deletedAt", (q) => q.eq("saveId", target._id).eq("deletedAt", undefined))
      .take(101);
    const sourcePhotos = await ctx.db
      .query("artworkPhotos")
      .withIndex("by_save_deletedAt", (q) => q.eq("saveId", source._id).eq("deletedAt", undefined))
      .take(101);
    const sourceEncounters = await ctx.db
      .query("artworkEncounters")
      .withIndex("by_save_deletedAt", (q) => q.eq("saveId", source._id).eq("deletedAt", undefined))
      .take(101);
    const targetEncounters = await ctx.db
      .query("artworkEncounters")
      .withIndex("by_save_deletedAt", (q) => q.eq("saveId", target._id).eq("deletedAt", undefined))
      .take(101);
    if (source.deletedAt === undefined) {
      if (
        targetPhotos.length + sourcePhotos.filter((photo) => photo.deletedAt === undefined).length > 100
        || new Set([...sourceEncounters, ...targetEncounters].map((row) => row.visitId)).size > 100
      ) {
        throw new ConvexError({ code: "album_full" });
      }
      for (const photo of sourcePhotos) {
        if (photo.deletedAt === undefined) {
          await invalidateAlbumPhoto(ctx, photo);
          await ctx.db.patch("artworkPhotos", photo._id, {
            saveId: target._id,
            savedLocalId: target.localId,
            updatedAt: Date.now(),
            changeVersion: await nextChangeVersion(ctx, owner),
          });
        }
      }
      for (const row of sourceEncounters) {
        if (row.deletedAt === undefined) {
          const prior = await ctx.db
            .query("artworkEncounters")
            .withIndex("by_save_visit", (q) => q.eq("saveId", target._id).eq("visitId", row.visitId))
            .unique();
          const fields = {
            owner,
            saveId: target._id,
            savedLocalId: target.localId,
            visitId: row.visitId,
            visitLocalId: row.visitLocalId,
            deletedAt: undefined,
            updatedAt: Date.now(),
            changeVersion: await nextChangeVersion(ctx, owner),
          };
          if (prior) await ctx.db.patch("artworkEncounters", prior._id, fields);
          else await ctx.db.insert("artworkEncounters", fields);
        }
      }
      await ctx.db.patch("collections", target._id, {
        updatedAt: Date.now(),
        updatedBy: device._id,
        changeVersion: await nextChangeVersion(ctx, owner),
      });
      await mergeSavedRecognition(ctx, source._id, target._id);
      await ctx.db.patch("collections", source._id, {
        deletedAt: Date.now(),
        updatedAt: Date.now(),
        updatedBy: device._id,
        changeVersion: await nextChangeVersion(ctx, owner),
      });
      await recordArtworkScore(ctx, owner, { ...source, deletedAt: Date.now() }, source);
      await invalidateDeletedSave(ctx, (await ctx.db.get("collections", source._id))!);
    }
    return {
      saves: [(await ctx.db.get("collections", source._id))!, (await ctx.db.get("collections", target._id))!],
      photos: [
        ...(await ctx.db
          .query("artworkPhotos")
          .withIndex("by_save_deletedAt", (q) => q.eq("saveId", target._id).eq("deletedAt", undefined))
          .take(101)),
        ...(await ctx.db
          .query("artworkPhotos")
          .withIndex("by_save_deletedAt", (q) => q.eq("saveId", source._id).eq("deletedAt", undefined))
          .take(101)),
      ],
      encounters: [
        ...(await ctx.db
          .query("artworkEncounters")
          .withIndex("by_save_deletedAt", (q) => q.eq("saveId", target._id).eq("deletedAt", undefined))
          .take(101)),
        ...(await Promise.all(sourceEncounters.map((row) => ctx.db.get("artworkEncounters", row._id)))).filter(
          (row) => row !== null,
        ),
      ],
    };
  },
});
