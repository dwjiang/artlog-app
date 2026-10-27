import { fileURLToPath } from "node:url";

import Limrun, { Ios } from "@limrun/api";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

import { createDemoApi } from "./server/demo-api.ts";
import { createDemoSessions } from "./server/demo-sessions.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// Serves the session API from the same origin as the page, in `vite dev` and `vite preview`.
function demoApi(env: Record<string, string>): Plugin {
  const api = () => {
    if (!env.LIM_API_KEY) throw new Error("Set LIM_API_KEY in the repository's .env.local");
    const sessions = createDemoSessions(
      {
        appAsset: env.DEMO_APP_ASSET || "artlog/judges-demo.app.tar.gz",
        phoneDir: fileURLToPath(new URL("./media/phone", import.meta.url)),
        accessCode: env.DEMO_ACCESS_CODE || undefined,
        // The Limrun account runs at most five simulators at once.
        maxLive: 5,
        maxPerDay: 30,
        maxUploads: 10,
      },
      new Limrun({ apiKey: env.LIM_API_KEY }).iosInstances,
      (apiUrl, token) => Ios.createInstanceClient({ apiUrl, token, logLevel: "error" }),
    );
    return createDemoApi(sessions);
  };
  return {
    name: "artlog-demo-api",
    configureServer: (server) => void server.middlewares.use(api()),
    configurePreviewServer: (server) => void server.middlewares.use(api()),
  };
}

export default defineConfig(({ mode }) => {
  // Only the Limrun key and demo settings leave .env.local, and only into this server process.
  const env = loadEnv(mode, repoRoot, ["LIM_", "DEMO_"]);
  return {
    plugins: [react(), demoApi(env)],
    server: { fs: { allow: [repoRoot] } },
  };
});
