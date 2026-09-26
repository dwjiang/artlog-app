# R2 file storage

File bytes live in a private Cloudflare R2 Standard bucket. Convex's `files` table
holds immutable object keys, metadata, upload ownership, and cleanup state. The
app's `storageId` fields hold opaque object keys, resolved through the `by_key`
index. Existing Convex file IDs can remain as keys when their bytes move to R2;
new files receive UUID keys. Neither requires a Convex storage record.

Embedding archives are private binary objects containing 512 little-endian float64
values. Vector metadata stores their SHA-256 and file key. Offline package builds,
training exports, and Pinecone rebuilds validate the bytes before using them.
Scan evidence and saved-artwork recognition use the same archive format; no database
table retains embedding arrays. Unsupported scan models retain no embedding payload.
Duplicate and grouping comparisons read R2 in actions, then commits recheck the
scan generation, contribution revisions, and selected supporting evidence.

Scan and rejection references expire after 180 days; contribution references last
until removal. Saved-artwork recognition references follow the saved artwork through
merges and deletion. These references can share an archive with a published vector.
Removing the final reference schedules archive expiry after a 31-minute grace
period, allowing in-flight readers to finish. Reattaching the archive cancels expiry.

## Configuration

Create a separate private bucket for each deployment. Keep public bucket access
and `r2.dev` disabled. Create S3 credentials with **Object Read & Write** permission
scoped to that bucket. Set these four variables on the corresponding Convex
deployment, using the placeholders in `.env.example`:

- `R2_BUCKET`
- `R2_ENDPOINT` — `https://<account-id>.r2.cloudflarestorage.com`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

These are backend secrets, never `EXPO_PUBLIC_` variables. If supplied through
`.env.local`, synchronize them with the Conductor root checkout and set them on
the dev deployment before deploying. Native iOS uploads do not require browser CORS.

## Delivery and cleanup

Private collection photos and shared media retain their authenticated HTTP
routes. Shared-media requests recheck publication permissions after reading R2.
Their bytes still pass through Convex to preserve revocation behavior.

Narration, profile photos, contribution thumbnails, and museum packages use
stable `/file?id=...` URLs. That endpoint returns an uncached redirect to a fresh,
one-hour R2 signed URL; the payload travels directly from R2. Only files explicitly
marked for public download can use it. Cached Convex query results therefore do
not contain expiring R2 URLs. Previously issued direct-download URLs can continue
working until expiry or physical deletion, as with other bearer links.

Contribution crops upload directly using a fifteen-minute signed PUT URL bound
to the file size, JPEG content type, and `If-None-Match: *`. The immutable object
cannot be overwritten through a reused upload URL. The contribution action checks
ownership and validates the uploaded bytes before committing the reference.

Uploads receive a 24-hour lease. Attaching a ready file clears the lease in the
same mutation that records its reference. Hourly cleanup removes abandoned
reservations and files never attached. Deletion immediately hides the registry
entry and queues an idempotent R2 deletion. Failures report through Sentry and
retry with backoff; the hourly sweep recovers interrupted deletion actions. Direct
uploads defer physical deletion until their upload URL has expired.

## Preserving an existing deployment

Export a snapshot with `npx convex export --include-file-storage --path snapshot.zip`.
Copy each exported file to R2 under its original `_storage` ID and verify its byte
size, content type, and SHA-256 against the snapshot. Populate `files` with ready
metadata under those keys before deploying the R2 backend. Keep the snapshot until
the cutover and file deletion are verified.

Preserve upload ownership for contribution crops. Mark only contribution thumbnails,
profile photos, narration, and museum-package chunks for public download; private
collection photos, derivatives, and ORB descriptors keep authenticated delivery.
Imported files have no expiry lease, so the cutover cannot expire existing content.

Existing artwork, descriptor, and vector records retain their IDs and file references.
Pinecone remains the search provider. Verify corpus counts, unchanged records, and
any files created since the snapshot before removing the old Convex bytes. There is
no runtime fallback to Convex storage.

After deployment, verify uploads, authenticated photos, public redirects, narration,
museum packages, and file deletion. A schema accepting string object keys permits
both existing references and newly generated UUIDs through the same storage path.
