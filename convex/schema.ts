// Schema per docs/design/art-identifier.md §5.3. Pre-release: change shapes directly; do not add migrations.
import { authTables } from '@convex-dev/auth/server';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

import model from '../shared/model-version.json';
import {
  challengePurpose,
  contributionField,
  contributionStatus,
  crawlRunStatus,
  devicePlatform,
  docentSentence,
  embedding,
  evidenceKind,
  factSheetEntry,
  feedbackResolution,
  indexStatusKind,
  matchOutcome,
  multiplicity,
  objectSource,
  placementSource,
  proposalKind,
  proposalStatus,
  rightsStatus,
  scanStatus,
  seedSource,
  snapshotFields,
  vectorSource,
} from './lib/validators';

const rightsRequest = {
  venueId: v.optional(v.id('museums')),
  artworkId: v.optional(v.id('artworks')),
  objectId: v.optional(v.id('objects')),
  requester: v.string(),
  receivedAt: v.number(),
  appliedAt: v.optional(v.number()),
};

export default defineSchema({
  ...authTables,

  artworks: defineTable({
    key: v.string(),
    wikidataId: v.optional(v.string()),
    title: v.string(),
    artist: v.string(),
    artistId: v.optional(v.string()),
    date: v.optional(v.string()),
    yearStart: v.optional(v.number()),
    yearEnd: v.optional(v.number()),
    rightsStatus,
    multiplicity,
    seriesId: v.optional(v.string()),
    factSheet: v.optional(v.array(factSheetEntry)),
    factSheetUpdatedAt: v.optional(v.number()),
    docent: v.optional(v.object({ en: v.optional(v.array(docentSentence)) })),
    docentUpdatedAt: v.optional(v.number()),
  })
    .index('by_key', ['key'])
    .index('by_wikidataId', ['wikidataId'])
    .index('by_artistId', ['artistId']),

  objects: defineTable({
    key: v.string(),
    artworkId: v.id('artworks'),
    ownerId: v.optional(v.id('museums')),
    accession: v.optional(v.string()),
    medium: v.optional(v.string()),
    dimensions: v.optional(v.string()),
    source: objectSource,
    sourceId: v.string(),
    imageRef: v.optional(v.string()),
    pageUrl: v.optional(v.string()),
    thumbnailUrl: v.optional(v.string()),
    confirmCount: v.number(),
    rejectCount: v.number(),
    calibratorPenalty: v.number(),
    mergedInto: v.optional(v.id('objects')),
    provenance: v.optional(
      v.object({
        contributionIds: v.array(v.id('contributions')),
        deviceIds: v.array(v.id('devices')),
      })
    ),
    reverted: v.boolean(),
  })
    .index('by_key', ['key'])
    .index('by_artworkId', ['artworkId'])
    .index('by_owner_accession', ['ownerId', 'accession']),

  placements: defineTable({
    objectId: v.id('objects'),
    venueId: v.id('museums'),
    gallery: v.optional(v.string()),
    onView: v.boolean(),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    source: placementSource,
    confidence: v.number(),
    closedAt: v.optional(v.number()),
  })
    .index('by_objectId', ['objectId'])
    .index('by_venueId', ['venueId']),

  placementProposals: defineTable({
    objectId: v.id('objects'),
    proposedVenueId: v.id('museums'),
    kind: proposalKind,
    scanIds: v.array(v.id('scans')),
    deviceIds: v.array(v.id('devices')),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    status: proposalStatus,
    readyForReview: v.boolean(),
    reviewer: v.optional(v.string()),
    reviewedAt: v.optional(v.number()),
  })
    .index('by_object_venue', ['objectId', 'proposedVenueId'])
    .index('by_status', ['status']),

  vectors: defineTable({
    objectId: v.id('objects'),
    modelVersion: v.string(),
    source: vectorSource,
    vector: embedding,
  })
    .vectorIndex('by_vector', {
      vectorField: 'vector',
      dimensions: model.embeddingDim,
      filterFields: ['modelVersion'],
    })
    .index('by_objectId_modelVersion_source', ['objectId', 'modelVersion', 'source']),

  descriptors: defineTable({
    objectId: v.id('objects'),
    descriptors: v.bytes(),
    keypoints: v.bytes(),
    keypointCount: v.number(),
    inputSize: v.number(),
    extractedFrom: v.string(),
  }).index('by_objectId', ['objectId']),

  museums: defineTable({
    key: v.string(),
    name: v.string(),
    lat: v.number(),
    lng: v.number(),
    website: v.optional(v.string()),
    collectionSiteUrl: v.optional(v.string()),
    platform: v.optional(v.string()),
    accessionUrlPattern: v.optional(v.string()),
    seedSource,
    wikidataId: v.optional(v.string()),
    region: v.string(),
    optOut: v.boolean(),
    crawlPolicy: v.optional(
      v.object({
        robotsAllowed: v.boolean(),
        termsChecked: v.boolean(),
        checkedAt: v.number(),
        crawlDelaySeconds: v.optional(v.number()),
        notes: v.optional(v.string()),
      })
    ),
    useTavilyCrawl: v.boolean(),
    queuePriority: v.number(),
    indexStatus: v.object({
      status: indexStatusKind,
      pagesMapped: v.number(),
      worksIndexed: v.number(),
      updatedAt: v.number(),
    }),
    lastCrawledAt: v.optional(v.number()),
    changeDetection: v.optional(
      v.object({
        sitemapLastmod: v.optional(v.string()),
        etag: v.optional(v.string()),
        lastModified: v.optional(v.string()),
      })
    ),
  })
    .index('by_key', ['key'])
    .index('by_wikidataId', ['wikidataId'])
    .index('by_queuePriority', ['queuePriority'])
    .index('by_indexStatus', ['indexStatus.status']),

  // Singleton maintained by convex/ingest.ts; counting large tables per query is too expensive.
  ingestCounters: defineTable({
    museums: v.number(),
    artworks: v.number(),
    objects: v.number(),
    placements: v.number(),
    vectors: v.number(),
    descriptors: v.number(),
  }),

  crawlRuns: defineTable({
    venueId: v.id('museums'),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    status: crawlRunStatus,
    pagesMapped: v.number(),
    worksIndexed: v.number(),
    error: v.optional(v.string()),
  }).index('by_venueId', ['venueId']),

  artistContext: defineTable({
    artistId: v.string(),
    region: v.string(),
    text: v.string(),
    sourceUrl: v.string(),
    sourceLabel: v.string(),
    empty: v.boolean(),
    fetchedAt: v.number(),
  }).index('by_artist_region', ['artistId', 'region']),

  contributions: defineTable({
    deviceId: v.id('devices'),
    venueId: v.id('museums'),
    scanId: v.optional(v.id('scans')),
    vector: embedding,
    modelVersion: v.string(),
    descriptors: v.bytes(),
    keypoints: v.bytes(),
    keypointCount: v.number(),
    cropStorageId: v.optional(v.id('_storage')),
    rawOcr: v.optional(v.any()),
    fields: v.object({
      title: contributionField,
      artist: contributionField,
      date: v.optional(contributionField),
      medium: v.optional(contributionField),
      accession: v.optional(contributionField),
      creditLine: v.optional(contributionField),
    }),
    evidence: v.array(evidenceKind),
    status: contributionStatus,
    promotedObjectId: v.optional(v.id('objects')),
    createdAt: v.number(),
  })
    .index('by_deviceId', ['deviceId'])
    .index('by_status', ['status'])
    .index('by_venue_status', ['venueId', 'status']),

  feedback: defineTable({
    scanId: v.id('scans'),
    deviceId: v.id('devices'),
    vector: embedding,
    modelVersion: v.string(),
    venueId: v.optional(v.id('museums')),
    rejectedObjectId: v.id('objects'),
    score: v.number(),
    margin: v.number(),
    orbInliers: v.number(),
    probability: v.number(),
    calibratorVersion: v.string(),
    venueMismatch: v.boolean(),
    resolution: feedbackResolution,
    createdAt: v.number(),
  })
    .index('by_rejectedObjectId', ['rejectedObjectId'])
    .index('by_device_object', ['deviceId', 'rejectedObjectId']),

  scans: defineTable({
    deviceId: v.id('devices'),
    localId: v.string(),
    generation: v.number(),
    venueId: v.optional(v.id('museums')),
    visitId: v.optional(v.id('visits')),
    gallery: v.optional(v.string()),
    modelVersion: v.string(),
    vector: embedding,
    // Descriptors and keypoints are kept only while status is `waiting` and cleared on resolution.
    descriptors: v.optional(v.bytes()),
    keypoints: v.optional(v.bytes()),
    keypointCount: v.optional(v.number()),
    capturedAt: v.number(),
    status: scanStatus,
    calibratorVersion: v.optional(v.string()),
    outcome: v.optional(matchOutcome),
    best: v.optional(
      v.object({
        objectId: v.id('objects'),
        artworkId: v.id('artworks'),
        probability: v.number(),
        gallery: v.optional(v.string()),
        corners: v.optional(v.array(v.array(v.number()))),
      })
    ),
    runnerUps: v.optional(
      v.array(
        v.object({
          objectId: v.id('objects'),
          artworkId: v.id('artworks'),
          probability: v.number(),
        })
      )
    ),
    docent: v.optional(v.array(docentSentence)),
    rightNow: v.optional(
      v.object({ text: v.string(), sourceUrl: v.string(), sourceLabel: v.string() })
    ),
    labelFlow: v.optional(v.any()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_device_localId', ['deviceId', 'localId'])
    .index('by_deviceId', ['deviceId'])
    .index('by_venue_status', ['venueId', 'status']),

  devices: defineTable({
    // Set by attestDevice once Apple has verified the key; absent until then.
    appAttestKeyId: v.optional(v.string()),
    authUserId: v.optional(v.string()),
    firstSeenAt: v.number(),
    trustWeight: v.number(),
    banned: v.boolean(),
    accountId: v.optional(v.id('accounts')),
    platform: devicePlatform,
    attestedAt: v.optional(v.number()),
    attestPublicKey: v.optional(v.string()),
    attestCounter: v.number(),
  })
    .index('by_keyId', ['appAttestKeyId'])
    .index('by_authUserId', ['authUserId'])
    .index('by_accountId', ['accountId']),

  attestChallenges: defineTable({
    deviceId: v.optional(v.id('devices')),
    authUserId: v.string(),
    nonce: v.string(),
    purpose: challengePurpose,
    createdAt: v.number(),
    usedAt: v.optional(v.number()),
  })
    .index('by_nonce', ['nonce'])
    .index('by_authUserId', ['authUserId']),

  dailySpend: defineTable({
    day: v.string(),
    tokenFactoryCalls: v.number(),
    tavilyCredits: v.number(),
    updatedAt: v.number(),
  }).index('by_day', ['day']),

  accounts: defineTable({
    appleUserId: v.string(),
    deviceIds: v.array(v.id('devices')),
    createdAt: v.number(),
  }).index('by_appleUserId', ['appleUserId']),

  visits: defineTable({
    deviceId: v.id('devices'),
    venueId: v.id('museums'),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    lastConfidentGallery: v.optional(v.string()),
    lastConfidentAt: v.optional(v.number()),
  }).index('by_device_started', ['deviceId', 'startedAt']),

  collections: defineTable({
    deviceId: v.id('devices'),
    accountId: v.optional(v.id('accounts')),
    localId: v.string(),
    visitId: v.optional(v.id('visits')),
    venueId: v.optional(v.id('museums')),
    gallery: v.optional(v.string()),
    savedAt: v.number(),
    snapshot: snapshotFields,
    objectId: v.optional(v.id('objects')),
    artworkId: v.optional(v.id('artworks')),
    scanId: v.optional(v.id('scans')),
    deletedAt: v.optional(v.number()),
  })
    .index('by_device_localId', ['deviceId', 'localId'])
    .index('by_accountId', ['accountId']),

  optOuts: defineTable(rightsRequest).index('by_venueId', ['venueId']),

  takedowns: defineTable(rightsRequest).index('by_artworkId', ['artworkId']),
});
