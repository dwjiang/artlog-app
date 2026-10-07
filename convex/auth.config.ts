import type { AuthConfig } from "convex/server";

import { DEMO_BOT_AUDIENCE, DEMO_BOT_ISSUER } from "./lib/demoBot";

// Convex evaluates this file on deploy and throws when it reads an unset variable. Catching that leaves the demo bot's
// provider out of deployments without DEMO_BOT_JWKS; after setting or rotating it, redeploy.
function demoBotJwks(): string | undefined {
  try {
    return process.env.DEMO_BOT_JWKS || undefined;
  } catch {
    return undefined;
  }
}
const jwks = demoBotJwks();

// A missing or wrong entry here signs every client out silently; keep it in sync with the deployment.
export default {
  providers: [
    { domain: process.env.CONVEX_SITE_URL!, applicationID: "convex" },
    ...(jwks
      ? [
          {
            type: "customJwt" as const,
            issuer: DEMO_BOT_ISSUER,
            applicationID: DEMO_BOT_AUDIENCE,
            jwks,
            algorithm: "ES256" as const,
          },
        ]
      : []),
  ],
} satisfies AuthConfig;
