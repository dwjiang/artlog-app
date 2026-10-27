# Judges demo page

- This folder is the browser demo for hackathon judges: it starts a Limrun cloud iPhone running the iOS app and
  streams it into the page. It is not a web build of the app, so the root rule against web residue does not apply.
- Keep its dependencies in this folder's `package.json`; app code never imports from here.
- The page receives only an instance's stream token; the Limrun API key and instance tokens stay in the server code.
- Checks: `npm run typecheck` and `npm test` in this folder; the root `npm run lint` also covers it.
