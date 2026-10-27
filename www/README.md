# Artlog in the browser

A page where hackathon judges try the Artlog iPhone app without an iPhone. Pressing **Start** asks the page's server
for a [Limrun](https://limrun.com) cloud iPhone with the app installed, copies `media/phone/` into the app, sets its
location to The Met, and streams the phone into the page.

The cloud iPhone has no camera the app can open and streams no sound. The demo build's Scan tab therefore plays
`media/phone/viewfinder.mp4` where the camera preview would be: the phone stands back from a gallery wall until the
judge picks a painting in the guide beside the phone, then walks up to it while the app's rectangle detection and
automatic capture run on the frames. The server writes the pick into the app's demo folder as `walk.json`; the app
opens Scan from wherever the judge is, and Scan takes the pick once it is looking for an artwork, so a pick made during
a scan waits until then. **Photos** opens the demo's own picker with the gallery stills and the judge's
uploads (**Upload a photo** in the guide), never the phone's sample photos. The page plays the audio guide: the
app writes what its guide plays to `Documents/judges-demo/narration.json`, the server polls that file and relays it,
and the page plays the same narration, streamed through the server from the backend or pulled from the phone's cache.

## Run it locally

1. Set `LIM_API_KEY` in the repository's `.env.local`.
2. Install and start, then open the `/demo/` URL Vite prints:

   ```sh
   cd www
   npm ci
   npm run dev
   ```

In Conductor, the **Judges demo** run action does step 2 on the workspace's second port and opens the page.

`DEMO_APP_ASSET` names the app build in Limrun's asset storage (default `artlog/judges-demo.app.tar.gz`).
`DEMO_ACCESS_CODE`, when set, makes the page ask for that code before starting a phone.

## Limits

A phone ends after 10 minutes without input or after 30 minutes. The server starts at most 5 phones at once (the
Limrun account's limit) and 30 a day, and takes up to 10 uploads per phone: JPEG, PNG or HEIC, up to 4 MB each (Vercel
rejects larger request bodies). The page re-encodes larger photos as 2560 px JPEGs first; browsers other than Safari
cannot decode HEIC, so a HEIC photo over 4 MB fails there. On Vercel each function instance counts its own starts in
progress and uploads, so concurrent instances can exceed those two limits until Limrun's account limit refuses a phone.

## Deploy

The page is served at https://artlog.dwjiang.com/demo by the Vercel project `artlog-www`, whose Root Directory is
`www`; `api/demo.ts` serves the same API as the Vite servers. The project is connected to this repository: a push to
`main` deploys to production and other branches get preview deployments, unless `ignoreCommand` in `vercel.json` finds
no change under `www/`, `shared/`, or `assets/fonts/` since that branch's last successful deployment. If no previous
deployment SHA is available, the build proceeds. Set `LIM_API_KEY` (and `DEMO_ACCESS_CODE` or `DEMO_APP_ASSET` when
used) in the project's environment variables. Only Production has `LIM_API_KEY`, so preview deployments serve the
page but not its API.

To deploy a local checkout without pushing, run from the repository root, so the function includes `shared/`:

```sh
vercel link --yes --project artlog-www
vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod
```

Without `--prebuilt`, `vercel deploy` uploads the whole checkout, including gitignored build output.

The same domain serves the app's legal pages: `vercel.json` rewrites `/privacy`, `/terms`, `/support` and `/licenses` to
the production Convex site.

## Re-render the gallery

`scripts/render-viewfinder.py` renders `media/phone/` from the reproductions in `media/paintings/` (about 4 minutes):
the viewfinder video, its segment list, painting thumbnails and gallery stills. Paintings, frames, labels and the
camera path are set in the script; `--preview` renders single frames for checking a change.

```sh
uv run www/scripts/render-viewfinder.py
```

## Refresh the app build

The phone runs a Release simulator build pointed at the production backend. `EXPO_PUBLIC_JUDGES_DEMO=1` makes it
skip the welcome, use the viewfinder video and demo photo picker on Scan, and report its audio guide to the page.
`NARRATION_SITE` in `server/demo-server.ts` must match the build's `EXPO_PUBLIC_CONVEX_SITE_URL`.

```sh
printf 'EXPO_PUBLIC_CONVEX_URL=https://admired-goldfinch-660.convex.cloud\nEXPO_PUBLIC_CONVEX_SITE_URL=https://admired-goldfinch-660.convex.site\nEXPO_PUBLIC_JUDGES_DEMO=1\n' > .env.production.local
npx expo prebuild --platform ios
cd ios
SENTRY_DISABLE_AUTO_UPLOAD=true xcodebuild -workspace Artlog.xcworkspace -scheme Artlog -configuration Release \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath build/demo \
  ARCHS=arm64 CODE_SIGN_IDENTITY=- build
tar -czf Artlog.app.tar.gz -C build/demo/Build/Products/Release-iphonesimulator Artlog.app
LIM_API_KEY=<key from .env.local> npx --prefix ../www lim asset push Artlog.app.tar.gz -n artlog/judges-demo.app.tar.gz
cd .. && rm .env.production.local
```

Keep `CODE_SIGN_IDENTITY=-`: an unsigned build has no keychain entitlement, so the app never finishes signing in.
