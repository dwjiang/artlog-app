import { fileURLToPath } from "node:url";

import Limrun, { Ios } from "@limrun/api";

import { createDemoApi } from "./demo-api.ts";
import { createDemoSessions } from "./demo-sessions.ts";

// The Convex site of the backend the demo app build uses (README.md, "Refresh the app build").
const NARRATION_SITE = "https://admired-goldfinch-660.convex.site";

export function createDemoServer(env: Record<string, string | undefined>) {
  if (!env.LIM_API_KEY) throw new Error("LIM_API_KEY is not set");
  const sessions = createDemoSessions(
    {
      appAsset: env.DEMO_APP_ASSET || "artlog/judges-demo.app.tar.gz",
      phoneDir: fileURLToPath(new URL("../media/phone", import.meta.url)),
      accessCode: env.DEMO_ACCESS_CODE || undefined,
      // The Limrun account runs at most five simulators at once.
      maxLive: 5,
      maxPerDay: 30,
      maxUploads: 10,
    },
    new Limrun({ apiKey: env.LIM_API_KEY }).iosInstances,
    (apiUrl, token) => Ios.createInstanceClient({ apiUrl, token, logLevel: "error" }),
  );
  return createDemoApi(sessions, NARRATION_SITE);
}
