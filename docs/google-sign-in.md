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
   Set these public variables in the build environment for any future EAS build too.
3. Set `GOOGLE_WEB_CLIENT_ID` on the matching Convex deployment to the same Web
   application client ID. For the current dev deployment:

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
