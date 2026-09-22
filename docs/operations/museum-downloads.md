# Museum downloads

Settings → Museum downloads lists published packages for the app's bundled model.
Each package contains established, eligible museum-owned objects with reference
embeddings, ORB features, and cached artwork metadata and reading. Only complete
packages become available for offline recognition. Unmatched scans keep the normal
reconnect queue; recognized scans use the existing result and collection flow.

To publish or refresh a museum, first confirm the intended Convex deployment, then
run `npx convex run museumDownloads:build '{"venueId":"<museum document ID>"}'`.
This internal function schedules bounded batches and atomically publishes the
finished package. Running it again restarts an interrupted build. Existing
downloads stay usable while their replacements download.

Rebuild packages after changing the corpus, cached artwork information, or bundled
model. The catalog excludes packages for other model versions and opted-out
museums. New packages omit withdrawn objects, user-supplied reference vectors, and
objects whose stored ORB reference cannot be read; the build logs each skip and
publishes the rest. Already downloaded packages remain local until updated or
removed.

Downloads live under the iPhone's `Documents/museum-downloads/`, separate from
journal photos. Closing downloads, backgrounding the app, or losing connectivity
pauses transfers; resume continues at the last verified chunk. Row menus check for
updates and remove packages without deleting saved artworks, notes, or photos.
