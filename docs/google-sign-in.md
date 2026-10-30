# Google sign-in setup

Google uses the native iOS sign-in SDK and the existing Convex device and journal
linking flow. The button stays disabled until both public client IDs are configured.

1. In [Google Auth Platform](https://console.cloud.google.com/auth/clients), select
   or create a project. Configure Branding with the Artlog name and contact emails,
   choose an External audience. Test users are optional for Artlog's basic identity
   scopes (`openid`, `email`, and `profile`), including while the project is in Testing;
   see [Google's audience rules](https://support.google.com/cloud/answer/15549945?hl=en).
   Create two OAuth clients in this same project: **iOS** with bundle
   ID `app.artlog.ios` (Apple Team ID `J4UW2CVVY4` if requested), and **Web application**
   for the backend token audience. Firebase is not required.
   No web redirect URI or client secret is needed for this native token flow.
2. Set `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
   in `.env.local` using the corresponding `*.apps.googleusercontent.com` IDs.
   In a Conductor workspace, set the same values in the root checkout's `.env.local`.
   Set these public variables in the build environment for EAS builds too.
3. Set `GOOGLE_WEB_CLIENT_ID` on the matching Convex deployment to the same Web
   application client ID. For the selected development deployment:

   ```sh
   npx convex env set GOOGLE_WEB_CLIENT_ID 'your-web-client.apps.googleusercontent.com'
   npx convex dev --once
   ```

   Check `CONVEX_DEPLOYMENT` first; production deployment is a separate explicit action.

4. Regenerate the iOS configuration and rebuild locally:

   ```sh
   npx expo prebuild --platform ios
   npm run ios
   ```

   `app.config.ts` derives the Google callback URL scheme from the iOS client ID.
   An existing binary must be rebuilt after adding or changing this ID.

5. Choose **Continue with Google**. Verify cancellation, sign-in, profile setup,
   journal sync, sign-out, and signing back into the same account on another device.

Accounts are keyed by provider and verified subject. Apple and Google sign-ins
remain separate Artlog accounts even when their email addresses match. Tokens are
verified against Google's signing keys, issuer, expiry, and the configured Web
client audience before an attested device can link its journal. Only verified
email addresses are stored. Account deletion removes the Google auth association
and uses the same journal cleanup as Apple.

References: [native Expo setup](https://react-native-google-signin.github.io/docs/setting-up/expo),
[Google token verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

The bundled `assets/images/google-g.png` is Google's unmodified
[official logo asset](https://developers.google.com/static/identity/images/g-logo.png)
from its [sign-in branding guidance](https://developers.google.com/identity/branding-guidelines).

## Failure diagnostics

`auth.google_sign_in` failures include an allowlisted operation context: failed
stage, bounded elapsed times, client-configuration presence, app lifecycle changes,
and numeric/known native error codes with known domains from up to three NSError
levels. Native error descriptions, userInfo payloads, credentials, client IDs,
account data, callback URLs, and view content are not included. The reported and
rethrown error has fixed copy so the outer account reporter deduplicates it.
Expected cancellations do not report errors.

The optional `SignInDiagnostics` iOS module takes read-only main-thread snapshots
before the SDK sign-in call and after failure. It records Guided Access state and
whether the SDK's presenter exists, has an attached window, or is transitioning.
These snapshots are not atomic with the SDK's presentation attempt. The
`native_sign_in` stage also includes the SDK waiting for configuration; it does
not prove that a browser or sheet opened. Snapshot absence, failure or a 150 ms
timeout must not prevent sign-in.

Apple and Google sheets open only once the app is active (waiting up to a minute),
and a missing-window failure (`ERR_WINDOW_UNAVAILABLE`, `NULL_PRESENTER`, or AppAuth's
"Unable to open Safari.") is retried once. Diagnostics record `active_wait`,
`presentation_retried` and `retry_active_wait`.

A native rebuild is required for the presentation module. When investigating a
new event, compare its release/build with that build's resolved `Podfile.lock`
versions for GoogleSignIn, AppAuth and GTMAppAuth; JavaScript package versions do
not identify the resolved native dependencies. Reproduce on iOS with normal and
interrupted sign-in, cancellation, and Guided Access where appropriate. These
diagnostics do not themselves fix browser presentation or establish recovery.
