import { leaderboardMetric, leaderboardVisibility } from '../shared/social/leaderboard';
import { authTables } from '@convex-dev/auth/server';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

import model from '../shared/model/model-version.json';
import { albumPhoto, albumEncounter } from '../shared/collection/album';
import { journalOwner, journalVisit, journalSave } from '../shared/journal/contracts';
import { wallLayout, relationshipState, publicationStatus, mediaSource, reportTarget, reportEvidence, reportReview, removal } from '../shared/social/contracts';
import {
  candidateSignal,
  challengePurpose,
  checklistExhibition,
  contributionField,
  contributionRejectedReason,
  contributionStatus,
  devicePlatform,
  docentSentence,
  embedding,
  evidenceKind,
  factSheetEntry,
  feedbackResolution,
  labelFlow,
  matchOutcome,
  multiplicity,
  museumSearchDisplay,
  objectSource,
  placementSource,
  proposalKind,
  proposalStatus,
  rightNowCard,
  rightsStatus,
  scanStatus,
  seedSource,
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
    // Set while a docent run owns the artwork; stale claims are reclaimed by docent.claim and enrich.claimBatch.
    enrichClaimedAt: v.optional(v.number()),
    enrichGeneration: v.optional(v.number()),
    factSheetNeedsReview: v.optional(v.boolean()),
  })
    .index('by_key', ['key'])
    .index('by_wikidataId', ['wikidataId'])
    .index('by_artistId', ['artistId'])
    .index('by_factSheetUpdatedAt', ['factSheetUpdatedAt']),

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
    // The contributor's consented crop: the card thumbnail for `source: user` works.
    thumbnailStorageId: v.optional(v.id('_storage')),
    confirmCount: v.number(),
    rejectCount: v.number(),
    calibratorPenalty: v.number(),
    rejectionPenalty: v.optional(v.number()),
    flaggedForReview: v.optional(v.boolean()),
    mergedInto: v.optional(v.id('objects')),
    provenance: v.optional(
      v.object({
        contributionIds: v.array(v.id('contributions')),
        deviceIds: v.array(v.id('devices')),
        verifiedAccession: v.optional(v.string()),
      })
    ),
    reverted: v.boolean(),
    revertedReason: v.optional(v.string()),
  })
    .index('by_key', ['key'])
    .index('by_artworkId', ['artworkId'])
    .index('by_artworkId_ownerId', ['artworkId', 'ownerId'])
    .index('by_owner_accession', ['ownerId', 'accession'])
    .index('by_source', ['source'])
    .index('by_flaggedForReview', ['flaggedForReview']),

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
    proposalId: v.optional(v.id('placementProposals')),
    closedByProposalId: v.optional(v.id('placementProposals')),
    exhibition: v.optional(v.object({ ...checklistExhibition.fields, timeZone: v.string() })),
  })
    .index('by_objectId', ['objectId'])
    .index('by_object_venue_source', ['objectId', 'venueId', 'source'])
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
    promotion: v.optional(v.object({
      placementId: v.id('placements'),
      closedPlacementIds: v.array(v.id('placements')),
    })),
    revertedAt: v.optional(v.number()),
  })
    .index('by_object_venue', ['objectId', 'proposedVenueId'])
    .index('by_status', ['status'])
    .index('by_status_readyForReview', ['status', 'readyForReview']),

  vectors: defineTable({
    objectId: v.id('objects'),
    modelVersion: v.string(),
    source: vectorSource,
    viewKey: v.optional(v.string()),
    vector: embedding,
  })
    .vectorIndex('by_vector', {
      vectorField: 'vector',
      dimensions: model.embeddingDim,
      filterFields: ['modelVersion'],
    })
    .index('by_objectId_modelVersion_source', ['objectId', 'modelVersion', 'source'])
    .index('by_modelVersion_source_viewKey', ['modelVersion', 'source', 'viewKey']),

  descriptors: defineTable({
    objectId: v.id('objects'),
    storageId: v.id('_storage'),
    sha256: v.string(),
    keypointCount: v.number(),
    inputSize: v.number(),
    extractedFrom: v.string(),
  })
    .index('by_objectId', ['objectId'])
    .index('by_storageId', ['storageId']),

  museums: defineTable({
    key: v.string(),
    name: v.string(),
    lat: v.number(),
    lng: v.number(),
    website: v.optional(v.string()),
    city: v.optional(v.string()),
    cityKey: v.optional(v.string()),
    country: v.optional(v.string()),
    collectionSiteUrl: v.optional(v.string()),
    platform: v.optional(v.string()),
    accessionUrlPattern: v.optional(v.string()),
    seedSource,
    wikidataId: v.optional(v.string()),
    region: v.string(),
    optOut: v.boolean(),
  })
    .index('by_key', ['key'])
    .index('by_wikidataId', ['wikidataId'])
    .index('by_lat', ['lat']),

  venueTables: defineTable({
    version: v.number(),
    storageId: v.id('_storage'),
    rowCount: v.number(),
    createdAt: v.number(),
  }).index('by_version', ['version']),

  // Singleton maintained by convex/ingest.ts; counting large tables per query is too expensive.
  ingestCounters: defineTable({
    museums: v.number(),
    artworks: v.number(),
    objects: v.number(),
    placements: v.number(),
    vectors: v.number(),
    descriptors: v.number(),
  }),

  // "Right now" cache keyed by artist and region. A row with `pendingAt` set is being fetched; the
  // scans listed in `waiting` receive the card when it lands, so concurrent misses spend one credit.
  artistContext: defineTable({
    artistId: v.string(),
    region: v.string(),
    text: v.string(),
    sourceUrl: v.string(),
    sourceLabel: v.string(),
    empty: v.boolean(),
    fetchedAt: v.number(),
    pendingAt: v.optional(v.number()),
    claimId: v.optional(v.string()),
    waiting: v.optional(v.array(v.object({ scanId: v.id('scans'), generation: v.number() }))),
  }).index('by_artist_region', ['artistId', 'region']),

  factCorrections: defineTable({
    artworkId: v.id('artworks'),
    factId: v.string(),
    message: v.string(),
    contact: v.optional(v.string()),
    deviceId: v.id('devices'),
    createdAt: v.number(),
    status: v.union(v.literal('open'), v.literal('resolved')),
  })
    .index('by_status', ['status'])
    .index('by_artworkId_status', ['artworkId', 'status']),

  contributions: defineTable({
    deviceId: v.id('devices'),
    venueId: v.id('museums'),
    scanId: v.optional(v.id('scans')),
    vector: embedding,
    modelVersion: v.string(),
    orbStorageId: v.optional(v.id('_storage')),
    orbSha256: v.optional(v.string()),
    keypointCount: v.number(),
    cropStorageId: v.optional(v.id('_storage')),
    displayMediaRevokedAt: v.optional(v.number()),
    rawOcr: v.optional(v.any()),
    sourceUrl: v.optional(v.string()),
    identityImageUrl: v.optional(v.string()),
    fields: v.object({
      title: contributionField,
      artist: contributionField,
      date: v.optional(contributionField),
      medium: v.optional(contributionField),
      accession: v.optional(contributionField),
      creditLine: v.optional(contributionField),
    }),
    evidence: v.array(evidenceKind),
    wikidataId: v.optional(v.string()),
    status: contributionStatus,
    rejectedReason: v.optional(contributionRejectedReason),
    promotedObjectId: v.optional(v.id('objects')),
    promotionNote: v.optional(v.string()),
    acceptedAt: v.optional(v.number()), creditedAccountId: v.optional(v.id('accounts')),
    createdAt: v.number(),
  })
    .index('by_deviceId', ['deviceId'])
    .index('by_scanId', ['scanId'])
    .index('by_cropStorageId', ['cropStorageId'])
    .index('by_orbStorageId', ['orbStorageId'])
    .index('by_device_status', ['deviceId', 'status'])
    .index('by_device_venue_model', ['deviceId', 'venueId', 'modelVersion'])
    .index('by_status', ['status'])
    .index('by_promotedObject_device', ['promotedObjectId', 'deviceId'])
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
    penaltyAdded: v.number(),
    resolution: feedbackResolution,
    // A duplicate depends on another resolution's vector and must be reconsidered if that vector is removed.
    multiViewAt: v.optional(v.number()),
    multiViewVectorId: v.optional(v.id('vectors')),
    multiViewDuplicateVectorId: v.optional(v.id('vectors')),
    multiViewAgreement: v.optional(v.object({ firstDeviceId: v.id('devices'), secondDeviceId: v.id('devices') })),
    createdAt: v.number(),
  })
    .index('by_rejectedObjectId', ['rejectedObjectId'])
    .index('by_device_object', ['deviceId', 'rejectedObjectId'])
    .index('by_scanId', ['scanId'])
    .index('by_venueId', ['venueId'])
    .index('by_resolution_object_venue', ['resolution.kind', 'resolution.objectId', 'venueId', 'createdAt'])
    .index('by_resolution_multiView', ['resolution.kind', 'multiViewAt', 'createdAt'])
    .index('by_multiViewFirstDevice', ['multiViewAgreement.firstDeviceId'])
    .index('by_multiViewDuplicateVectorId', ['multiViewDuplicateVectorId'])
    .index('by_multiViewSecondDevice', ['multiViewAgreement.secondDeviceId']),

  promotionState: defineTable({ multiViewCursor: v.union(v.string(), v.null()) }),

  museumWorkIdentities: defineTable({
    venueId: v.id('museums'),
    identity: v.string(),
    artworkId: v.id('artworks'),
  }).index('by_venue_identity', ['venueId', 'identity']),

  scans: defineTable({
    deviceId: v.id('devices'),
    localId: v.string(),
    generation: v.number(),
    venueId: v.optional(v.id('museums')),
    visitId: v.optional(v.id('visits')),
    gallery: v.optional(v.string()),
    modelVersion: v.string(),
    vector: embedding,
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
    candidateSignals: v.optional(v.array(candidateSignal)),
    rightNow: v.optional(rightNowCard),
    labelFlow: v.optional(labelFlow),
    museumSearch: v.optional(museumSearchDisplay),
    museumSearchRevision: v.optional(v.number()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_device_localId', ['deviceId', 'localId'])
    .index('by_deviceId', ['deviceId']),

  devices: defineTable({
    // Set by attestDevice once Apple has verified the key; absent until then.
    appAttestKeyId: v.optional(v.string()),
    authUserId: v.optional(v.string()),
    firstSeenAt: v.number(),
    trustWeight: v.number(),
    banned: v.boolean(),
    bannedReason: v.optional(v.string()),
    accountId: v.optional(v.id('accounts')),
    scopeRevision: v.optional(v.number()),
    appleLinkProof: v.optional(v.object({ sub: v.string(), email: v.optional(v.string()), expiresAt: v.number() })),
    platform: devicePlatform,
    attestedAt: v.optional(v.number()),
    attestPublicKey: v.optional(v.string()),
    attestCounter: v.number(),
    lastContributionId: v.optional(v.id('contributions')),
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
    email: v.optional(v.string()),
    deviceIds: v.array(v.id('devices')),
    createdAt: v.number(),
  }).index('by_appleUserId', ['appleUserId']),

  visits: defineTable({
    ...journalVisit.fields, owner: journalOwner, venueName: v.string(),
    lastConfidentGallery: v.optional(v.string()), lastConfidentAt: v.optional(v.number()),
    updatedAt: v.number(), updatedBy: v.id('devices'), changeVersion: v.number(),
  }).index('by_owner_localId', ['owner', 'localId'])
    .index('by_owner_history', ['owner', 'visitedOn', 'localId'])
    .index('by_owner_venue_history', ['owner', 'venueId', 'visitedOn', 'localId'])
    .index('by_owner_changeVersion', ['owner', 'changeVersion']),

  collections: defineTable({
    ...journalSave.fields, owner: journalOwner,
    cropStorageId: v.optional(v.id('_storage')),
    photoUpdatedAt: v.optional(v.number()), visitId: v.optional(v.id('visits')),
    scanId: v.optional(v.id('scans')), confirmationRecorded: v.optional(v.boolean()),
    updatedAt: v.number(), updatedBy: v.id('devices'), changeVersion: v.number(),
  }).index('by_owner_localId', ['owner', 'localId'])
    .index('by_owner_savedAt', ['owner', 'deletedAt', 'savedAt', 'localId'])
    .index('by_owner_changeVersion', ['owner', 'changeVersion'])
    .index('by_visitId', ['visitId'])
    .index('by_cropStorageId_deletedAt', ['cropStorageId', 'deletedAt']),

  artworkPhotos: defineTable({ ...albumPhoto.fields, owner: journalOwner, saveId: v.id('collections'),
    storageId: v.optional(v.id('_storage')), width: v.optional(v.number()), height: v.optional(v.number()), updatedAt: v.number(), changeVersion: v.number(),
  }).index('by_owner_localId', ['owner', 'localId']).index('by_saveId', ['saveId']).index('by_save_deletedAt', ['saveId', 'deletedAt'])
    .index('by_owner_changeVersion', ['owner', 'changeVersion']).index('by_storageId', ['storageId']),
  artworkEncounters: defineTable({ ...albumEncounter.fields, owner: journalOwner, saveId: v.id('collections'), visitId: v.id('visits'),
    updatedAt: v.number(), changeVersion: v.number(),
  }).index('by_save_visit', ['saveId', 'visitId']).index('by_save_deletedAt', ['saveId', 'deletedAt']).index('by_visitId', ['visitId'])
    .index('by_owner_changeVersion', ['owner', 'changeVersion']),

  journalSyncState: defineTable({ owner: journalOwner, version: v.number() }).index('by_owner', ['owner']),
  journalClaims: defineTable({
    deviceId: v.id('devices'), accountId: v.id('accounts'),
    phase: v.union(v.literal('visits'), v.literal('saves'), v.literal('complete')),
    createdAt: v.number(), completedAt: v.optional(v.number()),
  }).index('by_deviceId', ['deviceId']).index('by_accountId', ['accountId']),

  leaderboardScores: defineTable({ accountId: v.id('accounts'), metric: leaderboardMetric, period: v.string(), score: v.number() })
    .index('by_account_metric_period', ['accountId', 'metric', 'period']),
  leaderboardCredits: defineTable({ accountId: v.id('accounts'), objectId: v.id('objects'), acceptedAt: v.number() })
    .index('by_account_object', ['accountId', 'objectId']),
  profiles: defineTable({
    leaderboardVisibility: v.optional(leaderboardVisibility),
    removal: v.optional(removal),
    accountId: v.id('accounts'), username: v.string(), name: v.string(), bio: v.optional(v.string()),
    photoStorageId: v.optional(v.id('_storage')),
    searchText: v.string(), active: v.boolean(), publishedWallCount: v.number(), createdAt: v.number(), updatedAt: v.number(),
  }).index('by_accountId', ['accountId']).index('by_username', ['username']).index('by_active', ['active']).index('by_leaderboard', ['leaderboardVisibility'])
    .searchIndex('search_text', { searchField: 'searchText', filterFields: ['active'] }),
  walls: defineTable({ profileId: v.id('profiles'), color: v.string(), layoutRevision: v.number() })
    .index('by_profileId', ['profileId']),
  wallItems: defineTable({
    removal: v.optional(removal),
    wallId: v.id('walls'), profileId: v.id('profiles'), saveId: v.id('collections'), saveLocalId: v.string(),
    placementId: v.string(), photoLocalId: v.optional(v.string()),
    active: v.boolean(), layout: wallLayout, noteVisible: v.boolean(), noteRevision: v.number(), noteResetVersion: v.optional(v.number()),
  }).index('by_wall_active', ['wallId', 'active']).index('by_wall_placement', ['wallId', 'placementId']).index('by_save_active', ['saveId', 'active']),
  friendships: defineTable({
    firstProfileId: v.id('profiles'), secondProfileId: v.id('profiles'), requesterId: v.id('profiles'),
    state: relationshipState, revision: v.number(), updatedAt: v.number(),
  }).index('by_pair', ['firstProfileId', 'secondProfileId'])
    .index('by_first_state', ['firstProfileId', 'state']).index('by_second_state', ['secondProfileId', 'state']),
  blocks: defineTable({ blockerId: v.id('profiles'), blockedId: v.id('profiles'), revision: v.number(), active: v.boolean() })
    .index('by_pair', ['blockerId', 'blockedId']).index('by_blockedId', ['blockedId']),
  sharedVisits: defineTable({
    removal: v.optional(removal),
    postId: v.string(), profileId: v.id('profiles'), visitId: v.id('visits'), visitLocalId: v.string(),
    visitedOn: v.string(), status: publicationStatus, reflection: v.string(),
    publishedAt: v.number(), updatedAt: v.number(), publicationRevision: v.number(),
  }).index('by_postId', ['postId']).index('by_profile_visit', ['profileId', 'visitLocalId'])
    .index('by_profile_status_history', ['profileId', 'status', 'visitedOn', 'postId']).index('by_visitId', ['visitId']),
  sharedVisitItems: defineTable({
    publicationId: v.id('sharedVisits'), saveId: v.id('collections'), saveLocalId: v.string(), position: v.number(),
    photoLocalIds: v.optional(v.array(v.string())), highlighted: v.optional(v.boolean()),
  }).index('by_publication_position', ['publicationId', 'position']).index('by_publication_save', ['publicationId', 'saveId'])
    .index('by_saveId', ['saveId']),
  mediaAssets: defineTable({
    saveId: v.id('collections'), source: mediaSource, storageId: v.optional(v.id('_storage')),
    provenance: v.union(
      v.object({ kind: v.literal('catalog'), objectId: v.id('objects'), imageRightsEvidence: v.string() }),
      v.object({ kind: v.literal('contribution'), contributionId: v.id('contributions'), sourceStorageId: v.id('_storage') }),
    ),
    createdAt: v.number(), revokedAt: v.optional(v.number()),
  }).index('by_saveId', ['saveId']).index('by_save_kind', ['saveId', 'source.kind']).index('by_storageId', ['storageId'])
    .index('by_contribution_revoked', ['provenance.contributionId', 'revokedAt']),
  reports: defineTable({
    reporter: v.optional(journalOwner), target: reportTarget, reason: v.string(), details: v.optional(v.string()),
    evidence: reportEvidence, review: v.optional(reportReview),
    createdAt: v.number(), status: v.union(v.literal('open'), v.literal('resolved')),
  }).index('by_reporter_createdAt', ['reporter', 'createdAt']).index('by_status_createdAt', ['status', 'createdAt'])
    .index('by_target', ['target']).index('by_reporter_target_status', ['reporter', 'target', 'status']),

  optOuts: defineTable(rightsRequest).index('by_venueId', ['venueId']),

  takedowns: defineTable(rightsRequest).index('by_artworkId', ['artworkId']),
});
