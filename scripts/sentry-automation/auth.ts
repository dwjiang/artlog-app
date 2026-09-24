import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPOSITORY, staleCredential } from "./policy.ts";
import { command, request, required } from "./services.ts";

const directory = required("CODEX_HOME");
const authPath = join(directory, "auth.json");
const versionPath = join(directory, "secret-version.json");
const base = `https://api.github.com/repos/${REPOSITORY}`;
const secretPath = `${base}/actions/secrets/CODEX_AUTH_JSON`;

function assertSubscription(raw: string): void {
  let auth;
  try {
    auth = JSON.parse(raw);
  } catch {
    throw new Error("Subscription authentication is not valid JSON");
  }
  if (
    auth?.auth_mode !== "chatgpt"
    || typeof auth.tokens?.refresh_token !== "string"
    || !auth.tokens.refresh_token
    || typeof auth.tokens?.access_token !== "string"
    || !auth.tokens.access_token
    || auth.OPENAI_API_KEY
  ) {
    throw new Error("Expected refreshable ChatGPT subscription authentication, without an API key");
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === "restore") {
    if (required("GITHUB_REPOSITORY") !== REPOSITORY) throw new Error("Unexpected repository");
    const repo = await request<{ private: boolean }>(base, required("GH_TOKEN"));
    if (!repo.private) throw new Error("Subscription authentication requires a private repository");
    const version = await request<{ updated_at: string }>(secretPath, required("CODEX_AUTH_WRITE_TOKEN"));
    const run = await request<{ created_at: string }>(
      `${base}/actions/runs/${required("GITHUB_RUN_ID")}`,
      required("GH_TOKEN"),
    );
    if (staleCredential(run.created_at, version.updated_at)) {
      throw new Error("This run was queued before the login changed. Start a NEW workflow run; do not rerun this one.");
    }
    const raw = required("CODEX_AUTH_JSON");
    assertSubscription(raw);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    writeFileSync(authPath, raw, { mode: 0o600 });
    writeFileSync(versionPath, JSON.stringify(version), { mode: 0o600 });
    console.log("Restored subscription authentication.");
  } else if (mode === "persist") {
    if (!existsSync(versionPath) || !existsSync(authPath)) return;
    const current = await request<{ updated_at: string }>(secretPath, required("CODEX_AUTH_WRITE_TOKEN"));
    const restored = JSON.parse(readFileSync(versionPath, "utf8"));
    if (current.updated_at !== restored.updated_at) {
      throw new Error("Login secret changed during this run; refusing to overwrite it.");
    }
    const raw = readFileSync(authPath, "utf8");
    assertSubscription(raw);
    command("gh", ["secret", "set", "CODEX_AUTH_JSON", "--repo", REPOSITORY], {
      input: raw,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: "production",
        GH_TOKEN: required("CODEX_AUTH_WRITE_TOKEN"),
      },
    });
    console.log("Saved refreshed subscription authentication.");
  } else {
    throw new Error("Expected restore or persist");
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
