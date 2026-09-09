# Plan 05.04: Collection — grid and canvas views, search, visits grouping, saved-work detail with notes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- src/components/collection src/app/\(tabs\)/\(collection\) convex/artworks.ts`

## Status

- **Priority**: P1
- **Effort**: M–L
- **Risk**: LOW
- **Depends on**: 03.06 (local store), 04.09 (enrichment query), 01.02
- **Category**: feature (UI)
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §3: "Collection — grid and canvas views; search across title, artist, institution"; "Visits — group works by museum and date"; a saved work is an immutable snapshot of what the user saw, where and when; its `objectId` is used only to fetch artwork-level enrichment (docent text, "Right now"); the collection is local-first and browsable offline (§5.1).

## Current state

- Local repos (03.06): `listSavedWorks({ search? })`, `listVisits()`, `setNote`, `softDelete`; Drizzle `useLiveQuery`; photos at `photoPath`/`cropPath`.
- Routes (01.02): `(collection)/collection.tsx` (large title "Collection") and `[savedId].tsx` ("Saved work"); placeholders `CollectionScreen`, `SavedWorkScreen` with a placeholder link to remove.
- Backend: add `convex/artworks.ts` `enrichment` public query args `{ artworkId }` → `{ docent?: [...], factSheet?: [...], rightsStatus, thumbnailUrl? }` (in scope by exception; `requireDevice`), used by the detail screen when online.
- Expo Router skill: `Stack.SearchBar` for search; `@expo/ui` `SegmentedControl`/`Picker` for view switching; `FlatList` for large lists; `expo-image` with `contentFit`.

## Scope

**In scope**: `src/components/collection/{collection-screen,grid-view,canvas-view,visit-section-header,saved-work-screen,note-editor,snapshot-fields}.tsx` (+ tests), `src/lib/collection/{group-by-visit,search}.ts` (+ tests), `src/app/(tabs)/(collection)/_layout.tsx` (search bar options), `convex/artworks.ts` (+ test).

**Out of scope**: export (05.06), sync (04.11), any mutation of snapshot fields (by design none exist).

## Steps

### Step 1: Data helpers (pure)

`group-by-visit.ts`: `groupByVisit(works, visits) → [{ visit: { venueName, date }, works }]` sorted by most recent visit, works without a visit under "Imported"; `search.ts`: `filterWorks(works, query)` — case-insensitive substring on title, artist, institution (mirrors the repo's SQL search for offline filtering of already-loaded lists).

**Verify**: unit tests for grouping order, "Imported" bucket, and search on each field.

### Step 2: Collection screen

`collection-screen.tsx`: `useLiveQuery(listSavedWorks)`; header `Stack.SearchBar` (set in `(collection)/_layout.tsx`, `useSearch` per the router skill) filters via `filterWorks`; a `SegmentedControl` (Grid | Canvas | Visits); `grid-view.tsx` — 3-column `FlatList` of square thumbnails (`cropPath`, `expo-image`, `contentFit: 'cover'`), title/artist two-line caption; `canvas-view.tsx` — a horizontally scrolling "wall": each work as a framed image with a thin border and shadow (`boxShadow`), heights proportional to the crop's aspect (square crops → uniform; keep it simple), tap → detail; Visits mode — `SectionList` with `VisitSectionHeader` ("Metropolitan Museum of Art · 8 Sep 2026", count). Empty state: "Scan a painting to start your collection" with a link to the Scan tab.

**Verify**: RTL tests: renders items from fixtures; search narrows; empty state; section headers.

### Step 3: Saved-work detail

`saved-work-screen.tsx`: photo (`photoPath` full frame, fallback crop), `SnapshotFields` (read-only rows: title, artist, date, medium, institution, "Seen at <venue> · <date> · <gallery>"), `NoteEditor` (multiline, saves on blur via `setNote`), an "About this work" section from `useQuery(api.artworks.enrichment, artworkId ? { artworkId } : 'skip')` rendering docent sentences with source chips (reuse 05.02's `DocentSection`), and "Delete" (confirm → `softDelete`). Snapshot fields are never editable (no inputs).

**Verify**: RTL tests: note saves; snapshot fields are `Text` not inputs; enrichment renders when provided; delete calls the repo.

### Step 4: Backend query

`convex/artworks.ts` `enrichment` as above; test with convex-test.

**Verify**: `npx vitest run convex/artworks` passes; `npx convex dev --once`.

## Test plan

Pure tests for grouping/search; RTL tests for grid, sections, empty state, detail; convex test for `enrichment`.

## Done criteria

- [ ] `npm run test:app` ≥ 10 new; `npm run test:convex` +1; tsc/lint
- [ ] Simulator: grid/canvas/visits views, search, detail with a note, works offline (Airplane mode shows the collection)
- [ ] `grep -n "TextInput\|TextField" src/components/collection/snapshot-fields.tsx` → none
- [ ] `docs/plans/README.md` updated

## STOP conditions

- `Stack.SearchBar` is not available in the installed router — use a `TextInput` in the header and note it.

## Maintenance notes

- Canvas view is deliberately simple; a masonry layout is a later polish.
