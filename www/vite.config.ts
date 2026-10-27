import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

import { DEMO_BASE } from "./server/demo-api.ts";
import { createDemoServer } from "./server/demo-server.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// Serves the session API from the same origin as the page, in `vite dev` and `vite preview`.
function demoApi(env: Record<string, string>): Plugin {
  return {
    name: "artlog-demo-api",
    configureServer: (server) => void server.middlewares.use(createDemoServer(env)),
    configurePreviewServer: (server) => void server.middlewares.use(createDemoServer(env)),
  };
}

export default defineConfig(({ mode }) => {
  // Only the Limrun key and demo settings leave .env.local, and only into this server process.
  const env = loadEnv(mode, repoRoot, ["LIM_", "DEMO_"]);
  return {
    base: DEMO_BASE,
    // Vercel serves dist/, so the page's files land at the paths `base` gives them.
    build: { outDir: "dist/demo" },
    plugins: [react(), demoApi(env)],
    server: { fs: { allow: [repoRoot] } },
  };
});
