import { type Infer, v } from "convex/values";

export const rightsStatus = v.union(
  v.literal("public_domain"),
  v.literal("in_copyright"),
  v.literal("unknown"),
);
export type RightsStatus = Infer<typeof rightsStatus>;

export const multiplicity = v.union(
  v.literal("unique"),
  v.literal("multiple"),
  v.literal("unknown"),
);
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

export const proposalStatus = v.union(
  v.literal("pending"),
  v.literal("promoted"),
  v.literal("rejected"),
);
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
export const evidenceKind = v.union(
  ...labelEvidence.members,
  v.literal("agreement"),
  v.literal("user_edited"),
);
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
  kind: v.union(
    v.literal("runner_up"),
    v.literal("label"),
    v.literal("unresolved"),
    v.literal("false_rejection"),
  ),
  objectId: v.optional(v.id("objects")),
  contributionId: v.optional(v.id("contributions")),
});
export type FeedbackResolution = Infer<typeof feedbackResolution>;

export const factSheetEntry = v.object({
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

export const challengePurpose = v.union(
  v.literal("attest"),
  v.literal("assert"),
  v.literal("apple"),
);

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

export const labelFlow = v.object({
  stage: v.union(v.literal("qr"), v.literal("read"), v.literal("verified")),
  fields: labelFields,
  evidence: v.array(labelEvidence),
  warnings: v.array(labelWarning),
  moderation: v.union(v.literal("clear"), v.literal("flagged"), v.literal("unchecked")),
  promptVersion: v.optional(v.string()),
  rawOcr: v.optional(v.any()),
  sourceUrl: v.optional(v.string()),
  identityImageUrl: v.optional(v.string()),
  wikidataId: v.optional(v.string()),
  imageUrls: v.optional(v.array(v.string())),
  updatedAt: v.number(),
});
export type LabelFlow = Infer<typeof labelFlow>;

// The public shape of the label flow: the raw OCR reading stays server-side.
export const labelFlowDisplay = labelFlow.omit("rawOcr");
export type LabelFlowDisplay = Infer<typeof labelFlowDisplay>;

// The phone's verdict on a museum image: embedding cosine against the scan plus an ORB homography.
export const imageCheck = v.object({
  url: v.string(),
  cosine: v.number(),
  homographyValid: v.boolean(),
});
export type ImageCheck = Infer<typeof imageCheck>;

// An exhibition page from the venue's site whose images the phone checks; the page names the work at confirmation.
export const searchCandidate = v.object({
  sourceUrl: v.string(),
  exhibition: v.object({ title: v.string(), content: v.string() }),
  imageUrls: v.array(v.string()),
});
export type SearchCandidate = Infer<typeof searchCandidate>;

// Museum-site search state on a scan.
export const museumSearchDisplay = v.union(
  v.object({
    stage: v.literal("exhibitions"),
    candidates: v.array(searchCandidate),
    updatedAt: v.number(),
  }),
  v.object({
    stage: v.literal("none"),
    reason: v.union(v.literal("cap"), v.literal("identity_unresolved")),
    updatedAt: v.number(),
  }),
  v.object({
    stage: v.literal("confirmed"),
    candidates: v.array(searchCandidate),
    selected: v.object({ sourceUrl: v.string(), imageUrl: v.string() }),
    updatedAt: v.number(),
  }),
);
export type MuseumSearchDisplay = Infer<typeof museumSearchDisplay>;
