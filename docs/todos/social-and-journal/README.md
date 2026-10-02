# Social and journal contracts

Status: publication ownership and mutual friendship agreed by the user on
September 14, 2026. The remaining sections define the planned implementation
contracts for the mock; these APIs are not implemented yet.

This document fixes the boundaries needed to implement visits, walls, and the
social feed independently. Runtime validators, generated function types, and
tests become the implementation source of truth when those features are built.

## Decisions

| Decision            | Contract                                                                                                                                                                                                  | Status         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Publishing identity | A linked Apple account and an explicitly created profile are required to publish a wall, share visits, or connect with people. Scanning, private collecting, and public browsing remain account-optional. | Agreed by user |
| Friendship          | A request must be accepted by its recipient before either person gets friends-only access.                                                                                                                | Agreed by user |
| Visibility          | Wall selections are public; visit posts are friends-only; the complete journal is private.                                                                                                                | From mock      |
| Public note edits   | A selected note displays its current text. Editing it updates the public wall; removing its visibility prevents subsequent edits from publishing it.                                                      | From mock      |
| Feed order          | Descending visit date, with a stable tie-breaker; publication and edit timestamps never bump a visit.                                                                                                     | From mock      |

## Identity and ownership

Use the existing Convex `accounts` identity for a person across linked devices.
An authentication `users` ID or `devices` ID is not a public person's identity.
Give each account at most one `profiles` record; its document ID is the stable
public `profileId`. Keep Apple identifiers, email, account IDs, and device IDs
out of public profile responses.

| Identifier               | Meaning                                           | Boundary                                       |
| ------------------------ | ------------------------------------------------- | ---------------------------------------------- |
| `profileId`              | One person's public identity                      | Profiles, relationships, public reads          |
| `venueId`                | Existing `Id<'museums'>`                          | Catalog, visits, geographic summaries          |
| `visitLocalId`           | UUID generated when a particular visit is created | Journal and sync; survives device changes      |
| `saveLocalId`            | Existing saved-work `localId` UUID                | Journal, wall selection, visit selection       |
| `artworkId` / `objectId` | Existing catalog artwork / physical object IDs    | Recognition and enrichment; optional on a save |

The owner-scoped pair `(owner, localId)` identifies a journal record. Anonymous
records belong to their device; account-linked records belong to the account.
Private write endpoints derive that owner from authentication. They never accept
an arbitrary owner ID from the caller. Public mutations derive the profile from
the linked account; a target profile argument identifies another person, not the
author of the mutation.

Account linking claims the caller's anonymous journal, preserving save UUIDs,
visit UUIDs, and relationships. Repeated claims/sync must not create duplicate
records. Records already belonging to another account must not be silently
reassigned. Linking a second device resolves the same account-owned records.
The implementation must replace the present per-device collection-copy model
where necessary; no compatibility layer for pre-release data is required.

An artwork can be saved more than once, including on different visits. Those
are separate saves with separate notes. Never deduplicate saves using a catalog
artwork ID, or visits using a museum ID or date. Convex document IDs remain
internal relationship handles where appropriate; sync preserves the local UUIDs.

Profile fields are `username`, `name`, and optional `bio`. Proposed validation:
name 1–60 trimmed characters; bio at most 160; username 3–30 lowercase ASCII
letters/digits with single interior hyphens. Reserve usernames transactionally.
Usernames and display names can change in Edit Profile without changing profile
IDs. Search exposes public fields only.

Signing in does not create a public profile or publish existing saves. Profile
creation starts with an empty wall. Signing out ends authenticated access and
cancels queued public mutations; it does not unpublish existing content. Local
data and queued work retain their owner scope across account changes.

## Journal contract

An owner visit contains `visitLocalId`, `venueId`, `visitedOn`, `timeZone`, an
optional private reflection, optional actual `startedAt`/`endedAt` timestamps,
and server `updatedAt`/`updatedBy` stamps. `visitedOn` is a validated
`YYYY-MM-DD` calendar date; `timeZone` records its IANA zone. Creation/update
timestamps are UTC milliseconds.

Manual visits allow today or a past calendar date in the recorded zone. They do
not invent a scan-session start time. Capture-created visits use capture time
in the venue's zone; delayed uploads preserve that original date. Resolving the
zone can use venue coordinates, without uploading the user's raw GPS position.

A visit survives with zero saves, including after its last save is removed.
Returning to a museum creates a different visit UUID. Retrying creation with
the same UUID is idempotent. The current `startVisit` merge of a new local visit
into an open same-venue visit within four hours is superseded: every visit UUID
is its own visit, and a scan session joins an existing visit only when the app
passes that visit's UUID. Museum counts deduplicate by `venueId`; visit counts
count visit UUIDs. City grouping must distinguish identically named cities.

`museums` records carry no city or country today; `region` is a seed-region key
such as `sf-bay-area` or `country:unknown`. The integration owner adds optional
`city` and `country` (ISO 3166-1 alpha-2) to `museums`, filled by the venue seed
pipeline and by the MapKit placemark in `confirmPoiVenue`. Journal grouping and
shared-visit responses read those fields. A venue without a resolved city shows
its country only. A venue with neither (`confirmPoiVenue` creates
`country:unknown` venues today) shows its museum name alone, and journal
grouping keys it by `venueId` instead of a place.

A saved work retains its immutable metadata snapshot, optional catalog IDs,
optional `visitLocalId`, private note, and owned photo/crop references. A linked
save and visit must share an owner and venue. A save without a visit can appear
on a wall but cannot be selected for a visit post. Sync transfers visits and
save-to-visit links, including visits without saves.

Keep the existing 20,000-character artwork-note limit from
[`collection-limits.ts`](../../../shared/collection/collection-limits.ts). Use the
same limit for private visit reflections. This deliberately retains the existing
app limit instead of the mock's 3,000-character textarea limit. Shared visit
reflections have the mock's separate 1,200-character limit. Never truncate notes
silently, including a note explicitly selected for public display.

## Publication and read contracts

| Reader                                 | Public profile and wall                        | Published visit | Complete journal |
| -------------------------------------- | ---------------------------------------------- | --------------- | ---------------- |
| Signed-out visitor / stranger          | Yes                                            | No              | No               |
| Pending connection                     | Yes                                            | No              | No               |
| Accepted friend, neither side blocking | Yes                                            | Yes             | No               |
| Owner                                  | Yes, with owner controls in separate responses | Yes             | Yes              |

Build explicit response allowlists. Never serialize an owner record and rely on
the client to hide fields. The four shared response shapes are:

| Shape                           | Allowed content                                                                                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `PublicProfile`                 | Profile ID, username, name, bio, published-wall count                                                                                   |
| `WallArtwork`                   | Public item ID, layout, frame, artwork metadata, display media, explicitly selected public note                                         |
| `SharedVisit`                   | Public post ID, author profile, museum/city/country, visit date, selected artwork cards, shared reflection, publication/edit timestamps |
| `OwnerVisit` / `OwnerSavedWork` | Owner-scoped journal fields, including private notes and source associations                                                            |

Public wall artwork metadata can include title, artist, artwork date, medium,
and available sourced enrichment. It excludes the owner's save/visit UUIDs,
save time, visit dates, raw photos, scan records, private gallery/location
context, and full-archive statistics. Public item IDs resolve only through
currently published wall items. Missing enrichment or unknown catalog identity
does not prevent displaying a saved metadata snapshot.

Shared visit artwork cards contain no artwork notes, even if a note is separately
public on the wall. Wall membership and visit selection are independent. Shared
visit detail and its artwork/media endpoints perform the same current-access
check as the feed. Unauthorized and missing private records have the same
unavailable response. Counts and pagination metadata obey the same visibility.

### Wall

One wall belongs to one profile. It stores `color` and items with `saveLocalId`,
`x`, `y`, `width`, explicit layer order, `frame`, and independent note visibility.
Positions and widths are fractions of wall width; vertical position can exceed
one. Values must be finite, width positive, `x >= 0`, `y >= 0`, and
`x + width <= 1`. Frame IDs come from `shared/wall/frames.ts`. Aspect ratio comes from media dimensions, with a
defined placeholder when media is unavailable.

Adding an item publishes that selection with its note visibility off. Persist
completed edits, not every drag frame. Layout writes never carry note text or
overwrite note visibility. Taking down an item clears its public-note selection;
adding it again does not restore consent. Emptying a note also clears selection.
Wall edits never create feed events.

### Shared visits

At most one publication record belongs to `(profileId, visitLocalId)`. A
publication has a stable post ID, active/private status, selected save UUIDs,
shared reflection, first publication time, last update time, and revision.
Keep a record and revision after unsharing so stale writes cannot recreate it.

Publishing starts only after explicit confirmation. A draft/preview does not
write a publication. Preview uses the same allowlist/projection logic as the
published response. Private reflection text is not prefilled into shared text.
Publish/update validates ownership, visit membership, non-deletion, and unique
selected IDs. Zero selected artworks and an empty reflection are valid.

The audience is the owner's current accepted friends, including new friends
who join after publication. Unsharing or ending a friendship stops subsequent
authorized reads. An accepted relationship grants access to already shared
visits, not to private visits. Updating a post retains its ID. Sort feeds by
`visitedOn DESC, postId DESC`, and private history by
`visitedOn DESC, visitLocalId DESC`. Store `postId` as its own indexed string
field; a Convex `_id` cannot be an index field. Private history and
`listByProfile` are one index read descending, since `order('desc')` reverses
every index field; the mock's ascending tie-breaker only needs stability, not
direction. `listFeed` spans every accepted friend, so it merges one descending
index read per friend and paginates with a keyset cursor `(visitedOn, postId)`
rather than a Convex `paginate` cursor; there is no per-reader fan-out table to
backfill or prune. The accepted-friend limit in shared validators bounds that
merge. Cursors must use the same ordering.

### Relationships

For mutual friendship, one canonical unordered profile pair has
state `none`, `pending`, or `accepted`, with the requester identified. Only the
recipient can accept or decline; only the requester can cancel a pending request.
Either party can end an accepted friendship. A reverse request does not
implicitly accept the original request. Self-requests and duplicate edges are
invalid; repeated requests do not generate additional pending records.

Blocks are directional records. A block in either direction prevents requests,
removes pending/accepted relationships, and hides each person's walls, visits,
and reactions from the other while signed in; only the blocker can still open
the other's profile, to unblock. Each new block also opens a profile report for
moderation. Unblocking does not restore friendship. Public walls and visits stay
visible to signed-out visitors; blocking is not a promise to make public
material secret.

## Mutation, sync, and media boundaries

Use independent server revisions for wall layout, wall-note visibility, visit
publication, and relationship state. Updates supply the revision they observed.
A mismatch returns `conflict`; the client refetches and reconciles instead of
replaying a stale replacement. Idempotent create keys are the stable IDs above;
retries must not duplicate visits, wall items, posts, or relationships. Repeated
revoke/delete operations can succeed without changes.

Private content (notes, reflections, photos, visit fields) keeps the existing
last-writer-wins sync from `sync.ts`: the server stamps `updatedAt`/`updatedBy`,
never rejects a valid push for a version conflict, and deletion stays terminal.

Ordinary private-note/photo sync cannot grant publication, alter selected
artworks, or change friendship. Private edits may queue offline. Public actions
may remain local drafts offline but need server acknowledgement before the app
reports them as applied; stale permission changes require renewed confirmation.
An offline edit of a currently selected public note follows the live-note rule
when its text syncs, but cannot turn visibility back on after revocation.

Delete-save atomically makes the save unavailable to wall and shared-visit
projections, clears note visibility, and advances affected revisions. It retains
the visit and any zero-artwork visit post. File cleanup follows reference removal.
Deletion stays terminal after commit. Proposed Undo behavior: delay the deletion
commit during the short Undo window, so Undo cancels it; it never resurrects an
already deleted or unpublished record from a stale client snapshot.

Media resolves through its owner, wall item, or shared-visit item context. The
backend verifies the current parent and audience on every protected request.
Never expose arbitrary private storage IDs or reuse an owner-photo URL as a
public URL. Serve a publishable derivative or eligible catalog image; publication
does not by itself grant image rights. Store media dimensions and source/rights
metadata. If no publishable image exists, return metadata with a placeholder.

Unsharing prevents future service reads, including previously issued protected
media routes; it cannot retract bytes already downloaded. Private/friends-only
responses must not enter shared public caches. Public cache invalidation must
respect item removal and note-visibility changes. Signing out drops private
social caches. Account deletion immediately disables profile/publication access
and invalidates pending operations; cleanup can follow. Broader scan/contribution
retention remains the separately deferred product decision.

## API ownership for implementation

These are planned module boundaries, not existing callable endpoints. Owner
arguments are implicit. Generated Convex argument/return types will be consumed
directly; no second set of handwritten client DTOs.

| Stream   | Planned operations                                                                                                                                                   | Shared dependency                                        |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Identity | `profiles.create`, `update`, `getPublic`, `search`; authenticated profile resolution                                                                                 | Account linkage and publication policy                   |
| Journal  | `visits.upsertJournal`, `getMine`, `listMine`; visit/save sync and private note writes                                                                               | Owner scope, visit/save UUIDs, calendar date             |
| Wall     | `walls.getMine`, `getPublic`, `setLayout`, `setNoteVisibility`; item/media reads                                                                                     | Profile, owned saves, public artwork projection          |
| Social   | `friendships.request`, `accept`, `decline`, `cancel`, `remove`, `block`, `unblock`; `sharedVisits.preview`, `publish`, `unshare`, `get`, `listFeed`, `listByProfile` | Profile, journal membership, current relationship checks |

All list/search APIs are bounded and cursor-paginated. Normalize search queries
consistently, including case and accents. Responses expose only the reader's
allowed subset. Collection and museum catalog sizes must not be inferred from a
public wall response. Field, batch, and page bounds belong in shared validators;
their concrete limits must be set before implementing the affected endpoints.

Use the existing `unauthenticated`, `not_found`, and `rate_limited` errors and
the new `profile_required`, `username_taken`, and `conflict` consistently.
Rejected input follows the existing per-input `invalid_*` convention
(`invalid_visit`, `invalid_save`, `invalid_venue`), adding codes such as
`invalid_profile`, `invalid_wall`, and `invalid_post`; do not add a generic
validation code. Unavailable private targets use `not_found`; an owner gets
actionable validation errors about their own input. Map codes to copy in one
shared place rather than translating errors separately in each screen.

One integration owner edits `convex/schema.ts`, `src/db/schema.ts`, ownership
helpers, and shared validation. That owner coordinates generated Convex output.
Journal, wall, and social work can then proceed against these boundaries. Each
stream supplies its module validators and behavior tests; integration owns sync
and verification of the combined feature. This document does not start those
implementation streams.

## Acceptance examples

1. Two devices on one account show the same visit UUID, saves, and journal
   relationships. Two real visits to one museum remain distinct, including an
   empty visit. Retried creation adds neither a visit nor a save twice.
2. A stranger sees selected wall items and selected note text only. Supplying
   another person's save UUID or private visit ID grants no extra access.
3. A pending connection cannot read a shared visit. Acceptance permits only its
   selected artworks and shared reflection; removing/blocking the friend or
   unsharing the visit denies subsequent detail and protected-media reads.
4. A newer unshare/note-visibility change wins over delayed offline publication
   writes. Private sync alone never changes audience. Publishing a historical
   visit or editing its reflection preserves chronological placement.
5. Removing a wall item resets note visibility. Deleting the last save preserves
   the visit, removes its shared artwork references, and leaves an empty post
   if previously shared. Undo before commit cancels deletion; stale sync after
   commit cannot resurrect the save or its visibility.

## Scope and existing implementation anchors

This step defines contracts only. It does not change app behavior, deploy schema,
start a corpus upload, or release an iOS build. Public browser pages, a domain,
and the final profile-link destination are separate delivery decisions; the
public read API remains usable by a signed-out iOS client. New notifications,
messaging, reactions, and multiple walls are outside this mock's contract.

The relevant current implementations are
[`convex/schema.ts`](../../../convex/schema.ts),
[`accounts.ts`](../../../convex/accounts.ts),
[`visits.ts`](../../../convex/visits.ts),
[`sync.ts`](../../../convex/sync.ts),
[`collectionPhotos.ts`](../../../convex/collectionPhotos.ts), and
[`src/db/schema.ts`](../../../src/db/schema.ts).
