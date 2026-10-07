# Social and journal boundaries

Runtime contracts live in [shared/journal](../shared/journal/) and
[shared/social](../shared/social/). Validators and generated Convex types define
fields and limits; this document records ownership and publication boundaries.

## Ownership

Anonymous journals belong to a device; linked journals belong to an account.
Private operations derive ownership from authentication and verify the caller's
journal scope. A caller-supplied save, visit, or profile ID cannot grant access.
Local UUIDs identify journal records across sync and device changes.

Publishing and friendship require an account and an explicitly created profile.
Signing in does not create a public profile or publish existing saves. Public
profile responses omit account IDs, device IDs, provider identifiers, and email.
Apple and Google identities stay separate even when their email addresses match.

A visit uses a calendar date and IANA time zone, with a stable local identity.
Repeated writes with that identity are idempotent. Visits survive removal of
their last saved artwork. Saves, encounters, and photos retain owner-scoped
relationships; catalog artwork IDs are not journal ownership credentials.

## Publication

A wall publishes only selected artwork items. Notes remain private, including
notes attached to artworks visible on a wall or visit. A visit has a selected
`private`, `friends`, or `public` audience, selected artworks/photos, and a shared
reflection. Publication must not copy private reflection text without a user's
selection.

| Reader                                 | Public profile and wall | Public visit | Friends-only visit | Private journal |
| -------------------------------------- | ----------------------- | ------------ | ------------------ | --------------- |
| Signed-out visitor                     | Yes                     | Yes          | No                 | No              |
| Stranger or pending friend             | Yes                     | Yes          | No                 | No              |
| Accepted friend, neither side blocking | Yes                     | Yes          | Yes                | No              |
| Owner                                  | Yes                     | Yes          | Yes                | Yes             |

Blocks constrain signed-in access in either direction. Public material remains
accessible to signed-out readers. A friend request becomes accepted only through
the recipient's action; reversing a request does not accept it. Ending or blocking
a friendship removes friends-only access. Unblocking does not restore friendship.

Read responses use explicit projections. Public artwork metadata excludes private
notes, raw capture context, account identifiers, and complete-journal statistics.
Visit cards and protected media recheck the current publication and audience.
Unavailable private targets return the same response as missing targets.

## Sync and revocation

Private edits sync within their owner scope. Public changes use server revisions;
a conflict requires reading current state rather than replaying a stale
replacement. Private sync cannot create a publication or grant friendship.
Feed order follows the visit date with a stable tie-breaker, so editing or
publishing a historical visit does not move it to the top.

Deleting a save removes wall and visit selections, revokes display media,
and preserves the visit. Tombstones prevent stale sync from restoring deleted
records. Media access requires the current parent, ownership, audience, and
image rights; knowledge of a file ID alone is insufficient.

Unsharing prevents subsequent authorized service reads. It cannot retract bytes
already downloaded. Account deletion disables public access and queued operations
while cleanup proceeds. Signing out clears authenticated client access;
it does not itself withdraw published content.
