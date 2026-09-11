import { type Infer, v } from 'convex/values';

export const rightsStatus = v.union(
  v.literal('public_domain'),
  v.literal('in_copyright'),
  v.literal('unknown')
);
export type RightsStatus = Infer<typeof rightsStatus>;

export const multiplicity = v.union(v.literal('unique'), v.literal('multiple'), v.literal('unknown'));
export type Multiplicity = Infer<typeof multiplicity>;

export const objectSource = v.union(v.literal('corpus'), v.literal('user'));
export type ObjectSource = Infer<typeof objectSource>;

export const vectorSource = v.union(
  v.literal('corpus'),
  v.literal('user'),
  v.literal('user_scan')
);
export type VectorSource = Infer<typeof vectorSource>;

export const placementSource = v.union(
  v.literal('wikidata'),
  v.literal('feed'),
  v.literal('checklist'),
  v.literal('proposal'),
  v.literal('manual')
);
export type PlacementSource = Infer<typeof placementSource>;

export const seedSource = v.union(v.literal('wikidata'), v.literal('poi'), v.literal('manual'));
export type SeedSource = Infer<typeof seedSource>;

export const contributionStatus = v.union(
  v.literal('private'),
  v.literal('pending'),
  v.literal('promoted'),
  v.literal('rejected')
);
export type ContributionStatus = Infer<typeof contributionStatus>;

export const proposalStatus = v.union(
  v.literal('pending'),
  v.literal('promoted'),
  v.literal('rejected')
);
export type ProposalStatus = Infer<typeof proposalStatus>;

export const proposalKind = v.union(v.literal('move'), v.literal('new_object'));
export type ProposalKind = Infer<typeof proposalKind>;

export const scanStatus = v.union(
  v.literal('pending'),
  v.literal('identified'),
  v.literal('failed'),
  v.literal('unsupported_version')
);
export type ScanStatus = Infer<typeof scanStatus>;

export const matchOutcome = v.union(v.literal('confident'), v.literal('soft'), v.literal('miss'));
export type MatchOutcome = Infer<typeof matchOutcome>;

export const evidenceKind = v.union(
  v.literal('accession'),
  v.literal('qr'),
  v.literal('wikidata'),
  v.literal('tavily'),
  v.literal('agreement'),
  v.literal('user_edited')
);
export type EvidenceKind = Infer<typeof evidenceKind>;

export const feedbackResolution = v.object({
  kind: v.union(
    v.literal('runner_up'),
    v.literal('label'),
    v.literal('unresolved'),
    v.literal('false_rejection')
  ),
  objectId: v.optional(v.id('objects')),
  contributionId: v.optional(v.id('contributions')),
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

// Length is enforced in code against shared/model-version.json embeddingDim, not here.
export const embedding = v.array(v.float64());
export type Embedding = Infer<typeof embedding>;

export const devicePlatform = v.union(v.literal('ios'), v.literal('simulator'));

export const challengePurpose = v.union(v.literal('attest'), v.literal('assert'));

export const labelEvidence = v.union(
  v.literal('accession'),
  v.literal('qr'),
  v.literal('wikidata'),
  v.literal('tavily'),
  v.literal('tavily+image'),
  v.literal('weak'),
  v.literal('ocr')
);
export type LabelEvidence = Infer<typeof labelEvidence>;

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
  v.literal('artist_not_found'),
  v.literal('date_outside_lifespan'),
  v.literal('venue_unlikely')
);
export type LabelWarning = Infer<typeof labelWarning>;

export const labelFlow = v.object({
  stage: v.union(v.literal('qr'), v.literal('read'), v.literal('verified')),
  fields: labelFields,
  evidence: v.array(labelEvidence),
  warnings: v.array(labelWarning),
  moderation: v.union(v.literal('clear'), v.literal('flagged'), v.literal('unchecked')),
  promptVersion: v.optional(v.string()),
  rawOcr: v.optional(v.any()),
  sourceUrl: v.optional(v.string()),
  wikidataId: v.optional(v.string()),
  imageUrls: v.optional(v.array(v.string())),
  updatedAt: v.number(),
});
export type LabelFlow = Infer<typeof labelFlow>;
