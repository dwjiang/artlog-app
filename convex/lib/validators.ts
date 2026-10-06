import { type Infer, v } from "convex/values";

export const embeddingArchive = v.object({ archiveId: v.id("files"), contentHash: v.string() });
export type EmbeddingArchive = Infer<typeof embeddingArchive>;

export const rightsStatus = v.union(v.literal("public_domain"), v.literal("in_copyright"), v.literal("unknown"));
export type RightsStatus = Infer<typeof rightsStatus>;

export const multiplicity = v.union(v.literal("unique"), v.literal("multiple"), v.literal("unknown"));
export type Multiplicity = Infer<typeof multiplicity>;

export const objectSource = v.union(v.literal("corpus"), v.literal("user"));
export type ObjectSource = Infer<typeof objectSource>;

export const vectorSource = v.union(v.literal("corpus"), v.literal("user"), v.literal("user_scan"));
export type VectorSource = Infer<typeof vectorSource>;

export const placementSource = v.union(
  v.literal("wikidata"),
  v.literal("feed"),
  v.literal("checklist"),
  v.literal("proposal"),
  v.literal("contribution"),
  v.literal("manual"),
);
export type PlacementSource = Infer<typeof placementSource>;

export const checklistExhibition = v.object({
  title: v.string(),
  from: v.string(),
  to: v.string(),
  sourceUrl: v.string(),
});

export const seedSource = v.union(v.literal("wikidata"), v.literal("poi"), v.literal("manual"));
export type SeedSource = Infer<typeof seedSource>;

export const identityStatus = v.union(v.literal("established"), v.literal("tentative"));
export const contributionStatus = v.union(v.literal("tentative"), v.literal("rejected"));
export type ContributionStatus = Infer<typeof contributionStatus>;

export const proposalStatus = v.union(v.literal("pending"), v.literal("promoted"), v.literal("rejected"));
export type ProposalStatus = Infer<typeof proposalStatus>;

export const proposalKind = v.union(v.literal("move"), v.literal("new_object"));
export type ProposalKind = Infer<typeof proposalKind>;

export const scanStatus = v.union(
  v.literal("pending"),
  v.literal("identified"),
  v.literal("failed"),
  v.literal("unsupported_version"),
);
export type ScanStatus = Infer<typeof scanStatus>;

export const matchOutcome = v.union(v.literal("confident"), v.literal("soft"), v.literal("miss"));
export type MatchOutcome = Infer<typeof matchOutcome>;

export const labelEvidence = v.union(
  v.literal("accession"),
  v.literal("qr"),
  v.literal("wikidata"),
  v.literal("tavily"),
  v.literal("tavily+image"),
  v.literal("weak"),
  v.literal("ocr"),
);
export type LabelEvidence = Infer<typeof labelEvidence>;

// A contribution field keeps the label evidence it was verified with; editing it downgrades to user_edited.
export const evidenceKind = v.union(...labelEvidence.members, v.literal("agreement"), v.literal("user_edited"));
export type EvidenceKind = Infer<typeof evidenceKind>;

export const contributionRejectedReason = v.union(
  v.literal("duplicate"),
  v.literal("device_reverted"),
  v.literal("withdrawn"),
  v.literal("object_reverted"),
);
export type ContributionRejectedReason = Infer<typeof contributionRejectedReason>;

export const candidateSignal = v.object({
  identityStatus,
  objectId: v.id("objects"),
  similarity: v.number(),
  margin: v.number(),
  orbInliers: v.number(),
  probability: v.number(),
  homographyValid: v.boolean(),
});
export type CandidateSignal = Infer<typeof candidateSignal>;

export const feedbackResolution = v.object({
  kind: v.union(v.literal("runner_up"), v.literal("label"), v.literal("unresolved"), v.literal("false_rejection")),
  objectId: v.optional(v.id("objects")),
  contributionId: v.optional(v.id("contributions")),
});
export type FeedbackResolution = Infer<typeof feedbackResolution>;

export const factSheetEntry = v.object({
  referenceUrl: v.optional(v.string()),
  id: v.string(),
  text: v.string(),
  sourceUrl: v.string(),
  sourceLabel: v.string(),
  sourceScore: v.number(),
});
export type FactSheetEntry = Infer<typeof factSheetEntry>;

// A fact's citation as the card shows it: the text stays on the artwork.
export const factChip = v.object({
  id: v.string(),
  sourceUrl: v.string(),
  sourceLabel: v.string(),
});
export type FactChip = Infer<typeof factChip>;

export const docentSentence = v.object({
  sentence: v.string(),
  factIds: v.array(v.string()),
});
export type DocentSentence = Infer<typeof docentSentence>;

// The audio guide keeps the part of the stop each spoken sentence belongs to; the opening label line is part of the hook.
export const guideSection = v.union(v.literal("hook"), v.literal("look"), v.literal("story"), v.literal("takeaway"));
export type GuideSection = Infer<typeof guideSection>;
export const guideSentence = v.object({
  sentence: v.string(),
  factIds: v.array(v.string()),
  section: guideSection,
});
export type GuideSentence = Infer<typeof guideSentence>;

export const docentStatus = v.union(
  v.literal("ready"),
  v.literal("writing"),
  v.literal("failed"),
  v.literal("unavailable"),
);
export type DocentStatus = Infer<typeof docentStatus>;

export const rightNowCard = v.object({
  text: v.string(),
  sourceUrl: v.string(),
  sourceLabel: v.string(),
});
export type RightNowCard = Infer<typeof rightNowCard>;

export const snapshotFields = v.object({
  title: v.string(),
  artist: v.string(),
  date: v.optional(v.string()),
  medium: v.optional(v.string()),
  institution: v.optional(v.string()),
});
export type SnapshotFields = Infer<typeof snapshotFields>;

export const contributionField = v.object({
  value: v.string(),
  edited: v.boolean(),
  evidence: evidenceKind,
});
export type ContributionField = Infer<typeof contributionField>;

// Length is enforced in code against shared/model/model-version.json embeddingDim, not here.
export const embedding = v.array(v.float64());
export type Embedding = Infer<typeof embedding>;

export const devicePlatform = v.union(v.literal("ios"), v.literal("simulator"));

export const accountProvider = v.union(v.literal("apple"), v.literal("google"));
export type AccountProvider = Infer<typeof accountProvider>;
export const challengePurpose = v.union(v.literal("attest"), v.literal("assert"), ...accountProvider.members);

export const labelField = v.object({
  value: v.string(),
  confidence: v.optional(v.number()),
  evidence: labelEvidence,
  locked: v.boolean(),
});
export type LabelField = Infer<typeof labelField>;

export const labelFields = v.object({
  title: v.optional(labelField),
  artist: v.optional(labelField),
  date: v.optional(labelField),
  accession: v.optional(labelField),
  medium: v.optional(labelField),
  creditLine: v.optional(labelField),
});
export type LabelFields = Infer<typeof labelFields>;
export type LabelFieldName = keyof LabelFields;

export const labelWarning = v.union(
  v.literal("artist_not_found"),
  v.literal("date_outside_lifespan"),
  v.literal("venue_unlikely"),
);
export type LabelWarning = Infer<typeof labelWarning>;

export const labelReading = v.object({
  title: v.union(v.string(), v.null()),
  artist: v.union(v.string(), v.null()),
  artist_dates: v.union(v.string(), v.null()),
  work_date: v.union(v.string(), v.null()),
  medium: v.union(v.string(), v.null()),
  accession: v.union(v.string(), v.null()),
  credit_line: v.union(v.string(), v.null()),
  confidence: v.object({
    title: v.number(),
    artist: v.number(),
    work_date: v.number(),
    medium: v.number(),
    accession: v.number(),
  }),
});

export const labelFlow = v.object({
  stage: v.union(v.literal("qr"), v.literal("read"), v.literal("verified")),
  fields: labelFields,
  evidence: v.array(labelEvidence),
  warnings: v.array(labelWarning),
  moderation: v.union(v.literal("clear"), v.literal("flagged"), v.literal("unchecked")),
  promptVersion: v.optional(v.string()),
  rawOcr: v.optional(labelReading),
  sourceUrl: v.optional(v.string()),
  wikidataId: v.optional(v.string()),
  imageUrls: v.optional(v.array(v.string())),
  updatedAt: v.number(),
});
export type LabelFlow = Infer<typeof labelFlow>;

// The public shape of the label flow: the raw OCR reading stays server-side.
export const labelFlowDisplay = labelFlow.omit("rawOcr");
export type LabelFlowDisplay = Infer<typeof labelFlowDisplay>;

export const confirmedFields = v.object({
  title: v.string(),
  artist: v.optional(v.string()),
  date: v.optional(v.string()),
  accession: v.optional(v.string()),
  medium: v.optional(v.string()),
  creditLine: v.optional(v.string()),
});
export type ConfirmedFields = Infer<typeof confirmedFields>;
export const confirmedSource = v.union(v.literal("label"), v.literal("manual"));
export type ConfirmedSource = Infer<typeof confirmedSource>;

// The owner's own identification of a scan the index couldn't name. Its docent is private to the scan:
// typed details never become a catalogue artwork, so they get none of the artwork-keyed content.
export const confirmedDetails = v.object({
  source: confirmedSource,
  fields: confirmedFields,
  confirmedAt: v.number(),
  generation: v.number(),
  docentClaimedAt: v.optional(v.number()),
  docentFailedAt: v.optional(v.number()),
  // No sources or conflicting research: retrying would not help.
  docentUnavailable: v.optional(v.boolean()),
  factSheet: v.optional(v.array(factSheetEntry)),
  docent: v.optional(v.array(docentSentence)),
});
export type ConfirmedDetails = Infer<typeof confirmedDetails>;
export const confirmedDisplay = confirmedDetails.pick("source", "fields", "confirmedAt");

// The owner picked the catalogue work their label or details named; recognition's own fields stay as evidence.
export const scanLink = v.object({
  source: confirmedSource,
  objectId: v.id("objects"),
  artworkId: v.id("artworks"),
  linkedAt: v.number(),
});

// The phone's verdict on a museum image: embedding cosine against the scan plus an ORB homography.
export const imageCheck = v.object({
  url: v.string(),
  cosine: v.number(),
  homographyValid: v.boolean(),
});
export type ImageCheck = Infer<typeof imageCheck>;

export const orbReference = v.object({
  contributionId: v.optional(v.id("contributions")),
  proposalId: v.optional(v.id("placementProposals")),
  storageId: v.id("files"),
  sha256: v.string(),
  keypointCount: v.number(),
  inputSize: v.number(),
  extractedFrom: v.string(),
});

export const takedownTarget = v.union(
  v.object({ kind: v.literal("artwork"), artworkId: v.id("artworks") }),
  v.object({
    kind: v.literal("object"),
    objectId: v.id("objects"),
    identityArtworkId: v.id("artworks"),
    venueId: v.optional(v.id("museums")),
  }),
);

export const researchConflict = v.object({
  field: v.union(v.literal("artist"), v.literal("date")),
  text: v.string(),
  sourceUrl: v.string(),
  sourceLabel: v.string(),
  referenceUrl: v.string(),
});
export type ResearchConflict = Infer<typeof researchConflict>;

export const notificationEvent = v.union(
  v.object({ kind: v.literal("friendRequest") }),
  v.object({ kind: v.literal("friendAccepted") }),
  v.object({ kind: v.literal("visitLike"), publicationId: v.id("sharedVisits") }),
  v.object({
    kind: v.literal("visitComment"),
    publicationId: v.id("sharedVisits"),
    commentId: v.id("visitComments"),
  }),
  v.object({ kind: v.literal("visitCompanion"), publicationId: v.id("sharedVisits") }),
);
export type NotificationEvent = Infer<typeof notificationEvent>;
