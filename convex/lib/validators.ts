import { type Infer, v } from 'convex/values';

export const rightsStatus = v.union(
  v.literal('public_domain'),
  v.literal('in_copyright'),
  v.literal('unknown')
);
export type RightsStatus = Infer<typeof rightsStatus>;

export const multiplicity = v.union(v.literal('unique'), v.literal('multiple'), v.literal('unknown'));
export type Multiplicity = Infer<typeof multiplicity>;

export const objectSource = v.union(v.literal('corpus'), v.literal('crawl'), v.literal('user'));
export type ObjectSource = Infer<typeof objectSource>;

export const vectorSource = v.union(
  v.literal('corpus'),
  v.literal('crawl'),
  v.literal('user'),
  v.literal('user_scan')
);
export type VectorSource = Infer<typeof vectorSource>;

export const placementSource = v.union(
  v.literal('wikidata'),
  v.literal('feed'),
  v.literal('checklist'),
  v.literal('crawl'),
  v.literal('proposal'),
  v.literal('manual')
);
export type PlacementSource = Infer<typeof placementSource>;

export const seedSource = v.union(v.literal('wikidata'), v.literal('poi'), v.literal('manual'));
export type SeedSource = Infer<typeof seedSource>;

export const indexStatusKind = v.union(
  v.literal('none'),
  v.literal('queued'),
  v.literal('building'),
  v.literal('complete'),
  v.literal('no_index'),
  v.literal('opted_out')
);
export type IndexStatusKind = Infer<typeof indexStatusKind>;

export const crawlRunStatus = v.union(
  v.literal('running'),
  v.literal('complete'),
  v.literal('failed'),
  v.literal('capped'),
  v.literal('no_index')
);
export type CrawlRunStatus = Infer<typeof crawlRunStatus>;

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
  v.literal('waiting'),
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
