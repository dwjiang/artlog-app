# Demo activity

artlog-bot publishes posts, comments, and likes for the demo accounts through
`api.demoActivity` and `api.demoActivityPhotos`. Its
`docs/artlog-integration.md` owns the contract: operations, limits, error codes,
and the bot's queue. The functions' `args` and `returns` validators are the
machine-readable contract that artlog-bot's generated client is built from.

## Boundaries

Only the bot's service token reaches these functions, and only while the
deployment's flag is on; every other function reads that token as signed out.
The bot acts only as demo accounts (`demo:` Apple subjects whose profile is
active), reacts only to demo posts its author can read, and names only demo
accounts, so none of its writes notify a real person. Publishing goes through
the same journal, post, reaction, moderation, and rate-limit paths as the app.
Artlog never queues demo activity; a repeated submission returns its original
result and a reused ID with different content returns `conflict`.

## Deployment settings

| Variable             | Value                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `DEMO_BOT_JWKS`      | The bot's public JWKS as a `data:` URI. Unset removes the provider. Convex reads it on deploy: redeploy after any change. |
| `FLAG_DEMO_ACTIVITY` | `on` accepts activity; anything else answers `feature_off`.                                                               |

Each Artlog deployment pairs with one Bot deployment and never shares its key.
Configuring production or publishing to it requires an explicit request.

## Client types

After deploying a contract change to Artlog development, export the deployed
function spec and hand it to artlog-bot, which filters it to the two contract
modules, generates `convex/artlog/api.ts` with `convex-helpers ts-api-spec`, and
commits the result:

```sh
# In artlog-app:
npx convex function-spec > .context/function-spec.json
# In artlog-bot:
npm run artlog:api -- <artlog-app checkout>/.context/function-spec.json
```

Contract changes are breaking: deploy Artlog, regenerate the Bot client and
update its callers, then deploy the Bot.
