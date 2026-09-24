import { execFileSync } from "node:child_process";
import { REPOSITORY } from "./policy.ts";

export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export async function request<T>(url: string, token: string, method = "GET", body?: unknown): Promise<T> {
  if (method === "GET" && body !== undefined) throw new Error("GET requests cannot have a body");
  const response = await fetch(url, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`${method} ${new URL(url).pathname} returned HTTP ${response.status}`);
  return (await response.json()) as T;
}

export function github<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  return request<T>(`https://api.github.com/repos/${REPOSITORY}/${path}`, required("GH_TOKEN"), method, body);
}

export async function githubPages<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= 30; page++) {
    const batch = await github<T[]>(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error("Expected a GitHub list");
    items.push(...batch);
    if (batch.length < 100) return items;
  }
  throw new Error("GitHub pagination limit reached; refusing incomplete deduplication");
}

export function childEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "LANG", "CODEX_HOME"]
      .flatMap((name) => (process.env[name] ? [[name, process.env[name]]] : []))
      .concat([
        ["CI", "true"],
        ["NODE_ENV", "test"],
      ]),
  );
}

export function command(
  program: string,
  args: string[],
  options: { input?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {},
): string {
  try {
    return execFileSync(program, args, {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: options.timeout ?? 60_000,
      env: options.env ?? childEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
      input: options.input,
    }).replace(/\r?\n$/, "");
  } catch {
    // Child output can contain event data or credentials; keep it out of Actions logs.
    throw new Error(`${program} ${args[0] ?? ""} failed or timed out`);
  }
}

export function git(...args: string[]): string {
  return command("git", ["-c", "core.hooksPath=/dev/null", ...args]);
}
