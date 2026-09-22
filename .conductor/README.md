# Workspace archive cleanup

Archiving a local workspace stops its Expo, Metro, and Convex development
processes, including detached descendants, based on their working directory.
Unresponsive processes receive SIGKILL after three seconds. Other workspaces
and agent tooling stay running; cleanup does not rely on allocated ports.

Dedicated iOS simulators named `Artlog <workspace> [purpose]` are shut down and
their windows closed, including windows of already stopped devices. Devices and
app data remain. The workspace folder and display name both match, ignoring case,
spaces, hyphens, underscores, and optional number prefixes such as `03.07`.
Longer workspace names take precedence. A `v<number>` immediately after the name
denotes a different workspace, so `Artlog ndjamena V2 Layout` stays open when
archiving `ndjamena`.

Only use that naming convention for simulators dedicated to that workspace.
Shared devices such as `iPhone 17 Pro` stay open; the existing **iOS** Run action
does not create or claim a dedicated simulator. Rename a dedicated device with
`xcrun simctl rename <UDID> "Artlog <workspace>"` to include it in cleanup.

The hook reads `archive-workspace.cjs` from the local `origin/<default branch>`
Git ref, so even workspaces without the script get current cleanup. Conductor
loads shared settings from that branch; merge into `main` to activate it. A local
`scripts.archive` override takes precedence. Closing lingering windows uses
System Events and requires macOS Automation/Accessibility permission; failures
are reported without skipping server shutdown.

Run `npm run test:conductor` to check isolation and archive failure handling.
