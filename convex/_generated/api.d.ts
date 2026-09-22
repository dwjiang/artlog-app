/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as appAttestNode from "../appAttestNode.js";
import type * as appleLogin from "../appleLogin.js";
import type * as artworkAlbums from "../artworkAlbums.js";
import type * as artworks from "../artworks.js";
import type * as auth from "../auth.js";
import type * as checklists from "../checklists.js";
import type * as collectionPhotos from "../collectionPhotos.js";
import type * as collections from "../collections.js";
import type * as contributionRemoval from "../contributionRemoval.js";
import type * as contributions from "../contributions.js";
import type * as corrections from "../corrections.js";
import type * as crons from "../crons.js";
import type * as devices from "../devices.js";
import type * as displayMedia from "../displayMedia.js";
import type * as displayMediaPrepare from "../displayMediaPrepare.js";
import type * as docent from "../docent.js";
import type * as enrich from "../enrich.js";
import type * as feedback from "../feedback.js";
import type * as feedbackReplay from "../feedbackReplay.js";
import type * as friendships from "../friendships.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as identify from "../identify.js";
import type * as ingest from "../ingest.js";
import type * as journalClaims from "../journalClaims.js";
import type * as label from "../label.js";
import type * as leaderboards from "../leaderboards.js";
import type * as lib_agreement from "../lib/agreement.js";
import type * as lib_albumMedia from "../lib/albumMedia.js";
import type * as lib_appAttest from "../lib/appAttest.js";
import type * as lib_appleToken from "../lib/appleToken.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_calibrator_calibrate from "../lib/calibrator/calibrate.js";
import type * as lib_calibrator_features from "../lib/calibrator/features.js";
import type * as lib_calibrator_weights from "../lib/calibrator/weights.js";
import type * as lib_collectionPhotos from "../lib/collectionPhotos.js";
import type * as lib_collectionSiteProbe from "../lib/collectionSiteProbe.js";
import type * as lib_cosine from "../lib/cosine.js";
import type * as lib_displayMedia from "../lib/displayMedia.js";
import type * as lib_docentPrompts from "../lib/docentPrompts.js";
import type * as lib_docentSources from "../lib/docentSources.js";
import type * as lib_docentValidator from "../lib/docentValidator.js";
import type * as lib_exhibitionIdentity from "../lib/exhibitionIdentity.js";
import type * as lib_exhibitionSearch from "../lib/exhibitionSearch.js";
import type * as lib_flags from "../lib/flags.js";
import type * as lib_friendships from "../lib/friendships.js";
import type * as lib_identifyPipeline from "../lib/identifyPipeline.js";
import type * as lib_journal from "../lib/journal.js";
import type * as lib_journalVenue from "../lib/journalVenue.js";
import type * as lib_labelFixtures from "../lib/labelFixtures.js";
import type * as lib_labelPrompt from "../lib/labelPrompt.js";
import type * as lib_labelVerify from "../lib/labelVerify.js";
import type * as lib_leaderboard from "../lib/leaderboard.js";
import type * as lib_modelVersion from "../lib/modelVersion.js";
import type * as lib_moderation from "../lib/moderation.js";
import type * as lib_museumDownloadValidators from "../lib/museumDownloadValidators.js";
import type * as lib_museumWorkIdentity from "../lib/museumWorkIdentity.js";
import type * as lib_orbStorage from "../lib/orbStorage.js";
import type * as lib_ownership from "../lib/ownership.js";
import type * as lib_pageExtract from "../lib/pageExtract.js";
import type * as lib_placements from "../lib/placements.js";
import type * as lib_plausibility from "../lib/plausibility.js";
import type * as lib_politeFetch from "../lib/politeFetch.js";
import type * as lib_projections from "../lib/projections.js";
import type * as lib_publicArtworkStory from "../lib/publicArtworkStory.js";
import type * as lib_publicationAccess from "../lib/publicationAccess.js";
import type * as lib_rateLimits from "../lib/rateLimits.js";
import type * as lib_recognitionEligibility from "../lib/recognitionEligibility.js";
import type * as lib_regions from "../lib/regions.js";
import type * as lib_rejectionPenalty from "../lib/rejectionPenalty.js";
import type * as lib_rightNowAccept from "../lib/rightNowAccept.js";
import type * as lib_rightNowFixtures from "../lib/rightNowFixtures.js";
import type * as lib_sharedPublications from "../lib/sharedPublications.js";
import type * as lib_socialCleanup from "../lib/socialCleanup.js";
import type * as lib_socialTestFixtures from "../lib/socialTestFixtures.js";
import type * as lib_sourceScores from "../lib/sourceScores.js";
import type * as lib_spend from "../lib/spend.js";
import type * as lib_tavily from "../lib/tavily.js";
import type * as lib_tavilySpend from "../lib/tavilySpend.js";
import type * as lib_tentativeEntries from "../lib/tentativeEntries.js";
import type * as lib_testFactories from "../lib/testFactories.js";
import type * as lib_textMatch from "../lib/textMatch.js";
import type * as lib_tokenFactory from "../lib/tokenFactory.js";
import type * as lib_validators from "../lib/validators.js";
import type * as lib_venueFetch from "../lib/venueFetch.js";
import type * as lib_venueOptOut from "../lib/venueOptOut.js";
import type * as lib_wallFixtures from "../lib/wallFixtures.js";
import type * as lib_wikidata from "../lib/wikidata.js";
import type * as museumDownloads from "../museumDownloads.js";
import type * as museumSearch from "../museumSearch.js";
import type * as museums from "../museums.js";
import type * as orbFiles from "../orbFiles.js";
import type * as photoVisibility from "../photoVisibility.js";
import type * as placements from "../placements.js";
import type * as profilePhotoData from "../profilePhotoData.js";
import type * as profilePhotos from "../profilePhotos.js";
import type * as profiles from "../profiles.js";
import type * as promotion from "../promotion.js";
import type * as reports from "../reports.js";
import type * as revert from "../revert.js";
import type * as review from "../review.js";
import type * as rightNow from "../rightNow.js";
import type * as scans from "../scans.js";
import type * as sharedMedia from "../sharedMedia.js";
import type * as sharedVisits from "../sharedVisits.js";
import type * as spend from "../spend.js";
import type * as sync from "../sync.js";
import type * as venueTable from "../venueTable.js";
import type * as visits from "../visits.js";
import type * as walls from "../walls.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  appAttestNode: typeof appAttestNode;
  appleLogin: typeof appleLogin;
  artworkAlbums: typeof artworkAlbums;
  artworks: typeof artworks;
  auth: typeof auth;
  checklists: typeof checklists;
  collectionPhotos: typeof collectionPhotos;
  collections: typeof collections;
  contributionRemoval: typeof contributionRemoval;
  contributions: typeof contributions;
  corrections: typeof corrections;
  crons: typeof crons;
  devices: typeof devices;
  displayMedia: typeof displayMedia;
  displayMediaPrepare: typeof displayMediaPrepare;
  docent: typeof docent;
  enrich: typeof enrich;
  feedback: typeof feedback;
  feedbackReplay: typeof feedbackReplay;
  friendships: typeof friendships;
  health: typeof health;
  http: typeof http;
  identify: typeof identify;
  ingest: typeof ingest;
  journalClaims: typeof journalClaims;
  label: typeof label;
  leaderboards: typeof leaderboards;
  "lib/agreement": typeof lib_agreement;
  "lib/albumMedia": typeof lib_albumMedia;
  "lib/appAttest": typeof lib_appAttest;
  "lib/appleToken": typeof lib_appleToken;
  "lib/auth": typeof lib_auth;
  "lib/calibrator/calibrate": typeof lib_calibrator_calibrate;
  "lib/calibrator/features": typeof lib_calibrator_features;
  "lib/calibrator/weights": typeof lib_calibrator_weights;
  "lib/collectionPhotos": typeof lib_collectionPhotos;
  "lib/collectionSiteProbe": typeof lib_collectionSiteProbe;
  "lib/cosine": typeof lib_cosine;
  "lib/displayMedia": typeof lib_displayMedia;
  "lib/docentPrompts": typeof lib_docentPrompts;
  "lib/docentSources": typeof lib_docentSources;
  "lib/docentValidator": typeof lib_docentValidator;
  "lib/exhibitionIdentity": typeof lib_exhibitionIdentity;
  "lib/exhibitionSearch": typeof lib_exhibitionSearch;
  "lib/flags": typeof lib_flags;
  "lib/friendships": typeof lib_friendships;
  "lib/identifyPipeline": typeof lib_identifyPipeline;
  "lib/journal": typeof lib_journal;
  "lib/journalVenue": typeof lib_journalVenue;
  "lib/labelFixtures": typeof lib_labelFixtures;
  "lib/labelPrompt": typeof lib_labelPrompt;
  "lib/labelVerify": typeof lib_labelVerify;
  "lib/leaderboard": typeof lib_leaderboard;
  "lib/modelVersion": typeof lib_modelVersion;
  "lib/moderation": typeof lib_moderation;
  "lib/museumDownloadValidators": typeof lib_museumDownloadValidators;
  "lib/museumWorkIdentity": typeof lib_museumWorkIdentity;
  "lib/orbStorage": typeof lib_orbStorage;
  "lib/ownership": typeof lib_ownership;
  "lib/pageExtract": typeof lib_pageExtract;
  "lib/placements": typeof lib_placements;
  "lib/plausibility": typeof lib_plausibility;
  "lib/politeFetch": typeof lib_politeFetch;
  "lib/projections": typeof lib_projections;
  "lib/publicArtworkStory": typeof lib_publicArtworkStory;
  "lib/publicationAccess": typeof lib_publicationAccess;
  "lib/rateLimits": typeof lib_rateLimits;
  "lib/recognitionEligibility": typeof lib_recognitionEligibility;
  "lib/regions": typeof lib_regions;
  "lib/rejectionPenalty": typeof lib_rejectionPenalty;
  "lib/rightNowAccept": typeof lib_rightNowAccept;
  "lib/rightNowFixtures": typeof lib_rightNowFixtures;
  "lib/sharedPublications": typeof lib_sharedPublications;
  "lib/socialCleanup": typeof lib_socialCleanup;
  "lib/socialTestFixtures": typeof lib_socialTestFixtures;
  "lib/sourceScores": typeof lib_sourceScores;
  "lib/spend": typeof lib_spend;
  "lib/tavily": typeof lib_tavily;
  "lib/tavilySpend": typeof lib_tavilySpend;
  "lib/tentativeEntries": typeof lib_tentativeEntries;
  "lib/testFactories": typeof lib_testFactories;
  "lib/textMatch": typeof lib_textMatch;
  "lib/tokenFactory": typeof lib_tokenFactory;
  "lib/validators": typeof lib_validators;
  "lib/venueFetch": typeof lib_venueFetch;
  "lib/venueOptOut": typeof lib_venueOptOut;
  "lib/wallFixtures": typeof lib_wallFixtures;
  "lib/wikidata": typeof lib_wikidata;
  museumDownloads: typeof museumDownloads;
  museumSearch: typeof museumSearch;
  museums: typeof museums;
  orbFiles: typeof orbFiles;
  photoVisibility: typeof photoVisibility;
  placements: typeof placements;
  profilePhotoData: typeof profilePhotoData;
  profilePhotos: typeof profilePhotos;
  profiles: typeof profiles;
  promotion: typeof promotion;
  reports: typeof reports;
  revert: typeof revert;
  review: typeof review;
  rightNow: typeof rightNow;
  scans: typeof scans;
  sharedMedia: typeof sharedMedia;
  sharedVisits: typeof sharedVisits;
  spend: typeof spend;
  sync: typeof sync;
  venueTable: typeof venueTable;
  visits: typeof visits;
  walls: typeof walls;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
