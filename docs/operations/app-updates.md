# Required app updates

The startup gate compares the installed iOS build number with the selected
Convex deployment's `MINIMUM_IOS_BUILD`. Unset means no minimum. Use increasing
build numbers across releases; this is the native build, not the marketing
version. Numeric dotted builds are also supported.

Before raising the minimum, verify the replacement is downloadable for affected
users. Binaries without the gate cannot display the required-update screen. Describe the required-update behavior in App Review notes.

Check the selected deployment before each command. These commands target the
configured development deployment:

```sh
npx convex env get MINIMUM_IOS_BUILD
npx convex env set MINIMUM_IOS_BUILD 42
npx convex run appCompatibility:get '{}'
```

To remove the requirement:

```sh
npx convex env remove MINIMUM_IOS_BUILD
```

Production changes require explicit authorization and the production deployment
selector. Do not raise the production minimum while the replacement
is still in review or otherwise unavailable.

The app checks at launch, on foreground, on reconnect, and once per minute while
active. A launch with a cached answer for the deployment opens with that answer
while the check runs; a launch without one waits for the check before mounting
navigation and sync. An outdated build shows the update screen and unmounts the
app content, so a newly raised minimum can let a launch run briefly first. Each
successful response replaces the cached minimum, including removal of the
requirement. The cache is scoped to the deployment and survives an app upgrade.

A failed or four-second timed-out check uses the cached minimum. With no known
requirement, the app remains usable offline; a previously blocked build stays
blocked. A new binary meeting the cached minimum can open offline. A missing or
invalid native build is reported and does not lock out the app.

This is an app compatibility gate, not an API authorization boundary. Requests
already in flight and clients without the gate are not rejected by it. Breaking
backend changes still need server-side validation for the affected operations.

Both update prompts use Artlog's App Store listing by default. Set
`EXPO_PUBLIC_APP_STORE_URL` at build time to override the destination, for example
`itms-beta://` for TestFlight. A failed link leaves the update action available
for retry.
