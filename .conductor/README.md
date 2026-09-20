# Workspace simulator cleanup

Archiving a local workspace shuts down its running iOS simulators and closes
their windows. Devices and their app data remain available for reuse.

Name a dedicated simulator `Artlog <workspace>` with an optional purpose after
a space, for example `Artlog addis-ababa` or `Artlog Addis Ababa Guest Capture`.
`<workspace>` is the workspace folder or the name Conductor shows; the two differ
after a rename, and either matches. Matching ignores case and treats spaces,
hyphens, and underscores alike. Longer workspace names take precedence, so
archiving `ndjamena` leaves `ndjamena-v1` open. A `v<number>` word right after
the workspace name is reserved for such versioned workspaces, so do not start a
purpose with one: `Artlog ndjamena V2 Layout` is never shut down.

Only use that naming convention for simulators dedicated to that workspace.
Shared devices such as `iPhone 17 Pro` stay open; the existing **iOS** Run action
does not create or claim a dedicated simulator. Rename a dedicated device with
`xcrun simctl rename <UDID> "Artlog <workspace>"` to include it in cleanup.

The archive hook in `settings.toml` runs `./.conductor/archive-ios-simulators.sh`
when the workspace checkout contains it, so older branches still archive cleanly.
Conductor loads shared settings from the remote default branch; merge the change
into `main` to activate it. A local `scripts.archive` override takes precedence.

Run `npm run test:conductor` to check isolation and archive failure handling.
