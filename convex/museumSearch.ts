import { withErrorReporting } from "./lib/observability";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { resolveFalseRejections } from "./feedback";
import { moderateVerifiedFields } from "./label";
import { requireDeviceFromAction } from "./lib/auth";
import { isEnabled } from "./lib/flags";
import { exhibitionCandidates } from "./lib/exhibitionSearch";
import { resolveExhibitionIdentity } from "./lib/exhibitionIdentity";
import {
  FIELD_NAMES,
  displayLabelFlow,
  evidenceSummary,
  imageCheckPasses,
  labelField,
} from "./lib/labelVerify";
import type { PageFields } from "./lib/pageExtract";
import { limitDevice } from "./lib/rateLimits";
import { search } from "./lib/tavily";
import {
  imageCheck,
  labelFlow,
  labelFlowDisplay,
  museumSearchDisplay,
  type LabelField,
  type LabelFields,
  type LabelFlow,
  type LabelFlowDisplay,
  type MuseumSearchDisplay,
  type SearchCandidate,
} from "./lib/validators";
import { venueHosts } from "./lib/venueFetch";
import { isVenueOptedOut } from "./lib/venueOptOut";
import schema from "./schema";

type Retained = Exclude<MuseumSearchDisplay, { stage: "none" }>;

export const load = internalQuery({
  args: { scanId: v.id("scans"), deviceId: v.id("devices") },
  returns: v.object({
    scan: schema.doc("scans"),
    hosts: v.array(v.string()),
    venueName: v.string(),
  }),
  handler: async (ctx, { scanId, deviceId }) => {
    const scan = await ctx.db.get(scanId);
    if (
      !scan
      || scan.deviceId !== deviceId
      || !scan.venueId
      || scan.status !== "identified"
      || scan.outcome === "confident"
    ) {
      throw new ConvexError({ code: "invalid_scan" });
    }
    const venue = await ctx.db.get(scan.venueId);
    const hosts = venue ? venueHosts(venue) : [];
    if (!venue || !hosts.length) {
      throw new ConvexError({ code: "no_venue_site" });
    }
    if (await isVenueOptedOut(ctx, venue)) {
      throw new ConvexError({ code: "venue_opted_out" });
    }
    return { scan, hosts, venueName: venue.name };
  },
});

function ownedCurrentScan(
  scan: Doc<"scans"> | null,
  args: { deviceId: Doc<"devices">["_id"]; generation: number },
): Doc<"scans"> {
  if (!scan || scan.deviceId !== args.deviceId) {
    throw new ConvexError({ code: "invalid_scan" });
  }
  if (scan.generation !== args.generation) {
    throw new ConvexError({ code: "scan_restarted" });
  }
  return scan;
}

export const beginSearch = internalMutation({
  args: {
    scanId: v.id("scans"),
    deviceId: v.id("devices"),
    generation: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const scan = ownedCurrentScan(await ctx.db.get(args.scanId), args);
    const revision = (scan.museumSearchRevision ?? 0) + 1;
    await ctx.db.patch(scan._id, { museumSearchRevision: revision });
    return revision;
  },
});

export const write = internalMutation({
  args: {
    scanId: v.id("scans"),
    deviceId: v.id("devices"),
    generation: v.number(),
    revision: v.number(),
    museumSearch: museumSearchDisplay,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scan = ownedCurrentScan(await ctx.db.get(args.scanId), args);
    if (scan.museumSearchRevision !== args.revision) {
      throw new ConvexError({ code: "search_superseded" });
    }
    await ctx.db.patch(scan._id, {
      museumSearch: args.museumSearch,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const searchExhibitions = action({
  args: { scanId: v.id("scans") },
  returns: museumSearchDisplay,
  handler: async (ctx, { scanId }): Promise<MuseumSearchDisplay> =>
    withErrorReporting("museumSearch.searchExhibitions", async () => {
      const device = await requireDeviceFromAction(ctx);
      if (!isEnabled("museumSearch")) {
        throw new ConvexError({ code: "feature_off" });
      }
      const { scan, hosts, venueName } = await ctx.runQuery(
        internal.museumSearch.load,
        {
          scanId,
          deviceId: device._id,
        },
      );
      await limitDevice(ctx, "museumSearch", device._id);
      const revision = await ctx.runMutation(
        internal.museumSearch.beginSearch,
        {
          scanId,
          deviceId: device._id,
          generation: scan.generation,
        },
      );
      const write = (museumSearch: MuseumSearchDisplay) =>
        ctx.runMutation(internal.museumSearch.write, {
          scanId,
          deviceId: device._id,
          generation: scan.generation,
          revision,
          museumSearch,
        });
      let day: string;
      try {
        day = await ctx.runMutation(internal.spend.reserve, {
          kind: "tavily",
          amount: 1,
        });
      } catch (error) {
        if (
          !(error instanceof ConvexError)
          || error.data.code !== "spend_cap"
        ) {
          throw error;
        }
        const state: MuseumSearchDisplay = {
          stage: "none",
          reason: "cap",
          updatedAt: Date.now(),
        };
        await write(state);
        return state;
      }
      let credits = 1;
      try {
        const response = await search({
          query: `${venueName} current exhibitions`,
          includeDomains: hosts,
          includeImages: true,
          maxResults: 5,
        });
        credits = response.credits ?? 1;
        const state: MuseumSearchDisplay = {
          stage: "exhibitions",
          candidates: exhibitionCandidates(response, hosts),
          updatedAt: Date.now(),
        };
        await write(state);
        return state;
      } catch (error) {
        if (
          error instanceof ConvexError
          && error.data.code === "search_unconfigured"
        ) {
          credits = 0;
        }
        throw error;
      } finally {
        await ctx.runMutation(internal.spend.reconcile, {
          kind: "tavily",
          day,
          reserved: 1,
          actual: credits,
        });
      }
    }),
});

function retainedCandidate(
  state: MuseumSearchDisplay | undefined,
  sourceUrl: string,
  imageUrl: string,
): { state: Retained; candidate: SearchCandidate } | null {
  if (!state || state.stage === "none") return null;
  const candidate = state.candidates.find(
    (entry) =>
      entry.sourceUrl === sourceUrl && entry.imageUrls.includes(imageUrl),
  );
  return candidate ? { state, candidate } : null;
}

// The museum's page names the work and the phone confirmed its image, so title and artist carry
// `tavily+image`; the page's other fields carry `tavily`. All are locked.
function candidateFields(identity: PageFields): LabelFields {
  const fields: LabelFields = {};
  for (const name of FIELD_NAMES) {
    const value = identity[name];
    if (value) {
      fields[name] = labelField(
        value,
        name === "title" || name === "artist" ? "tavily+image" : "tavily",
      );
    }
  }
  return fields;
}

function confirmedFlow(
  candidate: SearchCandidate,
  imageUrl: string,
  fields: LabelFields,
  moderation: "clear" | "flagged",
): LabelFlow {
  return {
    stage: "verified",
    fields,
    evidence: evidenceSummary(fields),
    warnings: [],
    moderation,
    sourceUrl: candidate.sourceUrl,
    imageUrls: [imageUrl],
    identityImageUrl: imageUrl,
    updatedAt: Date.now(),
  };
}

function sameList(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean {
  return (
    (a ?? []).length === (b ?? []).length
    && (a ?? []).every((value, index) => value === b?.[index])
  );
}

function sameField(
  a: LabelField | undefined,
  b: LabelField | undefined,
): boolean {
  if (!a || !b) return a === b;
  return (
    a.value === b.value
    && a.evidence === b.evidence
    && a.locked === b.locked
    && a.confidence === b.confidence
  );
}

// A retried confirmation of the same page and image (lost response, reopened card) returns the
// stored result untouched; a flagged result with empty fields for that selection counts as stored too.
function storedConfirmation(
  scan: Doc<"scans">,
  flow: LabelFlow,
): LabelFlow | null {
  const search = scan.museumSearch;
  const stored = scan.labelFlow;
  if (search?.stage !== "confirmed" || !stored || stored.stage !== "verified") {
    return null;
  }
  if (
    search.selected.sourceUrl !== flow.sourceUrl
    || search.selected.imageUrl !== flow.imageUrls?.[0]
  ) {
    return null;
  }
  if (
    stored.sourceUrl !== flow.sourceUrl
    || !sameList(stored.imageUrls, flow.imageUrls)
  ) {
    return null;
  }
  const flaggedEmpty =
    stored.moderation === "flagged"
    && FIELD_NAMES.every((name) => !stored.fields[name])
    && !stored.evidence.length;
  const sameResult =
    FIELD_NAMES.every((name) =>
      sameField(stored.fields[name], flow.fields[name]),
    ) && sameList(stored.evidence, flow.evidence);
  return flaggedEmpty || sameResult ? stored : null;
}

export const confirm = internalMutation({
  args: {
    scanId: v.id("scans"),
    deviceId: v.id("devices"),
    generation: v.number(),
    labelFlow,
  },
  returns: labelFlowDisplay,
  handler: async (ctx, args): Promise<LabelFlowDisplay> => {
    const scan = ownedCurrentScan(await ctx.db.get(args.scanId), args);
    const flow = args.labelFlow;
    const imageUrl = flow.imageUrls?.[0];
    const selected =
      flow.sourceUrl !== undefined && imageUrl !== undefined
        ? { sourceUrl: flow.sourceUrl, imageUrl }
        : null;
    const retained =
      selected
      && retainedCandidate(
        scan.museumSearch,
        selected.sourceUrl,
        selected.imageUrl,
      );
    if (!selected || !retained) {
      throw new ConvexError({ code: "unknown_candidate" });
    }
    const stored = storedConfirmation(scan, flow);
    if (stored) return displayLabelFlow(stored);
    await ctx.db.patch(scan._id, {
      labelFlow: flow,
      // Confirming a retained candidate supersedes any search still in flight.
      museumSearchRevision: (scan.museumSearchRevision ?? 0) + 1,
      museumSearch: {
        stage: "confirmed",
        candidates: retained.state.candidates,
        selected,
        updatedAt: flow.updatedAt,
      },
      updatedAt: Date.now(),
    });
    await resolveFalseRejections(ctx, scan, flow);
    return displayLabelFlow(flow);
  },
});

// A matched image the page could not name is a terminal outcome: reopening the scan must not repeat
// the page fetch and caption model call. A newer search or confirmation is left untouched.
export const markUnresolved = internalMutation({
  args: {
    scanId: v.id("scans"),
    deviceId: v.id("devices"),
    generation: v.number(),
    sourceUrl: v.string(),
    imageUrl: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scan = ownedCurrentScan(await ctx.db.get(args.scanId), args);
    if (
      scan.museumSearch?.stage !== "exhibitions"
      || !retainedCandidate(scan.museumSearch, args.sourceUrl, args.imageUrl)
    ) {
      return null;
    }
    const updatedAt = Date.now();
    await ctx.db.patch(scan._id, {
      museumSearch: { stage: "none", reason: "identity_unresolved", updatedAt },
      updatedAt,
    });
    return null;
  },
});

export const confirmSearchCandidate = action({
  args: { scanId: v.id("scans"), sourceUrl: v.string(), imageCheck },
  returns: labelFlowDisplay,
  handler: async (
    ctx,
    { scanId, sourceUrl, imageCheck: check },
  ): Promise<LabelFlowDisplay> =>
    withErrorReporting("museumSearch.confirmSearchCandidate", async () => {
      const device = await requireDeviceFromAction(ctx);
      if (!isEnabled("museumSearch")) {
        throw new ConvexError({ code: "feature_off" });
      }
      const { scan, hosts } = await ctx.runQuery(internal.museumSearch.load, {
        scanId,
        deviceId: device._id,
      });
      const retained = retainedCandidate(
        scan.museumSearch,
        sourceUrl,
        check.url,
      );
      if (!retained) throw new ConvexError({ code: "unknown_candidate" });
      if (!imageCheckPasses(check)) {
        throw new ConvexError({ code: "image_mismatch" });
      }
      const { candidate } = retained;
      const previous = scan.labelFlow;
      if (
        scan.museumSearch?.stage === "confirmed"
        && previous?.stage === "verified"
        && scan.museumSearch.selected.sourceUrl === sourceUrl
        && scan.museumSearch.selected.imageUrl === check.url
        && previous.sourceUrl === sourceUrl
        && previous.identityImageUrl === check.url
      ) {
        return displayLabelFlow(previous);
      }
      await limitDevice(ctx, "labelVerify", device._id);
      // A page fetch or model failure propagates: only a page that cannot name the image is terminal.
      const identity = await resolveExhibitionIdentity(ctx, {
        sourceUrl,
        imageUrl: check.url,
        exhibitionTitle: candidate.exhibition.title,
        hosts,
      });
      if (!identity?.title || !identity.artist) {
        await ctx.runMutation(internal.museumSearch.markUnresolved, {
          scanId,
          deviceId: device._id,
          generation: scan.generation,
          sourceUrl,
          imageUrl: check.url,
        });
        throw new ConvexError({ code: "identity_unresolved" });
      }
      const fields = candidateFields(identity);
      const clear = confirmedFlow(candidate, check.url, fields, "clear");
      const stored = storedConfirmation(scan, clear);
      if (stored) return displayLabelFlow(stored);
      const moderation = await moderateVerifiedFields(
        ctx,
        fields,
        scan.labelFlow,
      );
      return ctx.runMutation(internal.museumSearch.confirm, {
        scanId,
        deviceId: device._id,
        generation: scan.generation,
        labelFlow:
          moderation === "flagged"
            ? confirmedFlow(candidate, check.url, {}, "flagged")
            : clear,
      });
    }),
});
