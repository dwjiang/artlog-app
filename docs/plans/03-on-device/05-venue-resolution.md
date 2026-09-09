# Plan 03.05: On-device venue resolution — location, the bundled venue table, POI fallback, and the "Looks like you're at X" sheet

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- src/lib/venue src/components/venue modules/poi-search app.json assets/venues.db`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED (native MapKit module; background table refresh)
- **Depends on**: 02.02 (venue asset + `venueTable.latest`), 04.05 (`startVisit`, `confirmPoiVenue`), 01.04, `docs/decisions/006-native-modules.md`
- **Category**: feature
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §4.2 "The venue table" / §5.1: the venue table ships in the app; on open and on every scan the phone takes a one-shot fix (While Using only), finds the nearest row within ~150 m and starts or resumes the visit; the server only ever sees a `venueId`; when nothing seeded is nearby, a local MapKit POI search proposes venues in one sheet; the same sheet appears when two seeded venues are within range. No geofences, no background location.

## Current state

- `assets/venues.db` (SQLite `venues(id, key, name, lat, lng, website, region)`, `meta(version, generatedAt, rowCount)`) and `metro.config.js` with the `db` asset extension (02.02); Convex `venueTable.latest` → `{ version, rowCount, url }`.
- Convex (04.05): `startVisit({ venueId, localVisitId })` → `{ visitId, indexStatus }`; `confirmPoiVenue({ name, website?, lat, lng })` → `{ venueId }` (attested write); `museums.getStatus`.
- `src/app/venue-picker.tsx` renders `VenuePickerSheet` (formSheet, 01.02).
- Verified SDK 57 facts: `expo-location` `requestForegroundPermissionsAsync()`, `getCurrentPositionAsync({ accuracy: Accuracy.Balanced })`, plugin `["expo-location", { "locationWhenInUsePermission": "…" }]`; `expo-sqlite` `SQLiteProvider databaseName="venues.db" assetSource={{ assetId: require('@/assets/venues.db') }}` + `useSQLiteContext()`, `openDatabaseAsync`, `db.getAllAsync(sql, params)`; `expo-file-system` `File.downloadFileAsync(url, dest)`, `Paths.document`; MapKit: `MKLocalPointsOfInterestRequest(center:radius:)` with `pointOfInterestFilter = MKPointOfInterestFilter(including: [.museum])`, `MKLocalSearch(request:).start()` → `mapItems` (`name`, `placemark.coordinate`, `url`), fallback `MKLocalSearch.Request` with `naturalLanguageQuery = "art gallery"` and a region; minimum iOS 14.0 for `MKLocalPointsOfInterestRequest`, below the app’s 16.4 minimum (00.06 SDK-header and device check).

## Scope

**In scope**: `package.json`, `app.json` (location plugin), `src/lib/venue/{resolve,venue-db,refresh,use-venue}.ts` (+ tests), `modules/poi-search/**` (Expo DSL module), `src/components/venue/venue-picker-sheet.tsx` (real content), `src/app/_layout.tsx` (mount `SQLiteProvider` for the venue DB), `src/components/scan/scan-screen.tsx` (call `useVenue` and pass `venueId/visitId` to the pipeline).

**Out of scope**: visit UI in the collection (05.04), server-side queue bump (04.05), geofencing (explicitly rejected by design).

## Steps

### Step 1: The venue database on the phone

`venue-db.ts`: `openVenueDb()` — uses the bundled asset on first launch; if `Paths.document/venues.db` exists and its `meta.version` is newer, open that instead. `refresh.ts`: `refreshVenueTableInBackground(latest)` — when `venueTable.latest.version > local meta.version`, download to `Paths.document/venues.db.tmp` then rename (swap applies on next open). `nearest(db, lat, lng, radiusM)` → rows within a bounding box (`lat ± radius/111_000`, `lng ± radius/(111_000·cos lat)`) sorted by haversine distance.

**Verify**: `resolve.test.ts` tests `haversine`, bounding box, and the pure `pickVenue(rows)` below with in-memory rows; on device, `nearest` at a known museum coordinate returns it.

### Step 2: Resolution rules (pure)

`resolve.ts`: `pickVenue(candidates: (VenueRow & { distanceM })[]) → { kind: 'auto'; venue } | { kind: 'choose'; options } | { kind: 'none' }`: `auto` when exactly one row ≤ 150 m, or the nearest is ≤ 150 m and the next is > 400 m; `choose` when ≥ 2 rows ≤ 400 m; `none` otherwise. `resolveVenueAt(lat, lng)` (async) composes `nearest` + `pickVenue`; used for library imports (EXIF) too.

**Verify**: tests for each branch and boundary distances.

### Step 3: POI search module

`modules/poi-search/` (DSL): `AsyncFunction("searchNearby") { (lat: Double, lng: Double, radiusMeters: Double) -> [PoiRecord] }` with `PoiRecord { name, lat, lng, website?, category }`: run `MKLocalPointsOfInterestRequest` with `.museum`, then a `MKLocalSearch.Request` with `naturalLanguageQuery = "art gallery"` in the same region even when museum results are nonempty (00.06 found SFMOMA classified as a landmark); merge, dedupe by name+distance, sort by distance, ≤ 8 results. No API key.

**Verify**: device: at a downtown coordinate returns nearby museums/galleries with websites where MapKit has them.

### Step 4: The hook and the sheet

`use-venue.ts`: `useVenue()` → `{ status: 'idle' | 'locating' | 'resolved' | 'choose' | 'none' | 'denied', venue?, visitId?, options?, resolve(), confirm(option) }`: on app open and on each scan (throttled: skip if the last fix is < 3 min old and the app was not backgrounded): request permission (When In Use), one-shot fix, `resolveVenueAt`; `auto` → `startVisit`; `choose`/`none` → open `/venue-picker` with options (`none` → `PoiSearch.searchNearby(lat, lng, 300)`); `confirm(option)`: seeded → `startVisit`; POI → `confirmPoiVenue` then `startVisit`. Sheet: title "Looks like you're at…", list of options with distance, "Not here" to dismiss (visit stays unset). Persist the current visit (`venueId`, `visitId`, `startedAt`) in the local store (03.06's `settings` table; until then `expo-sqlite` localStorage polyfill).

**Verify**: `use-venue` logic is tested via a pure reducer `venueReducer(state, event)` (jest); device: opening the app at a museum resolves and `startVisit` runs (Convex dashboard shows a visit).

### Step 5: Background refresh and wiring

Call `refreshVenueTableInBackground` after app launch (once per day, `settings.venueTableCheckedAt`); wire `venueId/visitId` into the scan pipeline; Import path uses EXIF → `resolveVenueAt` (no visit).

**Verify**: bump `venueTables` on the dev deployment (publish a new version via 02.02's `--publish`) and confirm the app downloads it (log) and uses it after restart.

## Test plan

`resolve.test.ts` (≥ 8 cases), `venue-reducer.test.ts` (state transitions), jest; device walkthrough at a real museum or with the Simulator's custom location set to a museum's coordinates (Features → Location → Custom Location) — the Simulator can exercise everything except MapKit results quality.

## Done criteria

- [ ] Simulator with a custom location at the Met resolves `auto` and starts a visit
- [ ] Two nearby venues produce the chooser; no venue produces POI options on a device
- [ ] Background refresh works; `git ls-files assets/venues.db` → 1 (bundled asset committed by 02.02)
- [ ] Tests, tsc, lint pass; `docs/plans/README.md` updated

## STOP conditions

- `SQLiteProvider assetSource` fails to copy the bundled DB — try the `expo-asset` + `File.copy` route once, then report.
- MapKit POI search returns nothing on a device in a city center — report (fallback: manual venue search field, a scope change).

## Maintenance notes

- 150 m / 400 m thresholds are named constants; museums with big footprints may need a per-venue radius later (`museums.radiusM` — not now).
- Coordinates never leave the phone; keep `confirmPoiVenue` the only call that sends a coordinate, and only for a user-confirmed POI.
