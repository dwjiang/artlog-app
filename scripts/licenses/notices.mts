import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type Notice = {
  name: string;
  version?: string;
  license: string;
  holder?: string;
  source: "npm" | "pod" | "bundled";
  url?: string;
  text: string;
};
export type NoticeEntry = Omit<Notice, "text"> & { text: number };
export type ThirdPartyNotices = { entries: NoticeEntry[]; texts: string[] };
export type Pod = { name: string; version: string; path?: string };
export type Acknowledgement = { title: string; license: string; text: string };
export type LicenseOverrides = Record<string, Pick<Notice, "license" | "text" | "holder"> & { url: string }>;
export type PrebuiltNotices = Record<string, { version: string; entries: Omit<Notice, "source">[] }>;

const packageSegment = "node_modules/";

/** Package directories for every bundled source path, resolved against the project root. */
export function packageDirsFromSources(sources: Iterable<string>, root: string): string[] {
  const dirs = new Set<string>();
  for (const source of sources) {
    const at = source.lastIndexOf(packageSegment);
    if (at < 0) continue;
    const [first, second] = source.slice(at + packageSegment.length).split("/");
    const name = first.startsWith("@") ? `${first}/${second}` : first;
    const dir = source.slice(0, at + packageSegment.length) + name;
    dirs.add(dir.startsWith(root) ? dir : resolve(root, dir.replace(/^\/+/, "")));
  }
  return [...dirs].sort();
}

/** Top-level pods with their versions and, for local pods, the path CocoaPods resolved them from. */
export function parsePodfileLock(text: string): Pod[] {
  const blocks = new Map(text.split(/\n\n+(?=\S)/).map((block) => [block.slice(0, block.indexOf(":")), block]));
  const pods = new Map<string, Pod>();
  for (const [, name, version] of (blocks.get("PODS") ?? "").matchAll(
    /^ {2}- "?([^ "/(]+)(?:\/[^ "(]+)?"? \(([^)]+)\)/gm,
  )) {
    if (!pods.has(name)) pods.set(name, { name, version });
  }
  for (const [, name, path] of (blocks.get("EXTERNAL SOURCES") ?? "").matchAll(
    /^ {2}([^:\n]+):\n {4}:(?:path|podspec): "?([^"\n]+)"?/gm,
  )) {
    const pod = pods.get(name);
    if (pod) pod.path = path;
  }
  return [...pods.values()];
}

/** Pods whose license text CocoaPods found, from the generated acknowledgements plist. */
export function parseAcknowledgements(plist: string): Acknowledgement[] {
  const entries: Acknowledgement[] = [];
  for (const [, dict] of plist.matchAll(/<dict>((?:(?!<dict>)[\s\S])*?)<\/dict>/g)) {
    const fields = new Map<string, string>();
    for (const [, key, value] of dict.matchAll(/<key>([^<]+)<\/key>\s*<string>([\s\S]*?)<\/string>/g)) {
      fields.set(key, unescapeXml(value));
    }
    const title = fields.get("Title");
    const license = fields.get("License");
    const text = fields.get("FooterText");
    if (title && license && text) entries.push({ title, license, text: text.trim() });
  }
  return entries;
}

function unescapeXml(value: string): string {
  const named: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
  return value.replaceAll(/&(lt|gt|amp|quot|apos|#\d+);/g, (_, code: string) =>
    code.startsWith("#") ? String.fromCodePoint(Number(code.slice(1))) : named[code],
  );
}

/** The nearest enclosing npm package of a native source path. */
export function nearestPackageDir(path: string): string | undefined {
  for (let dir = path; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "package.json"))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

const licenseFileName = /^(licen[cs]e|copying|unlicense)\b/i;

/** The package's license file, preferring the plain LICENSE over variants such as LICENSE-MIT.txt. */
export function findLicenseFile(dir: string): string | undefined {
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && licenseFileName.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  return names[0] && join(dir, names[0]);
}

export function npmNotice(dir: string, overrides: LicenseOverrides): Notice {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const license: unknown = typeof pkg.license === "object" ? pkg.license?.type : pkg.license;
  if (typeof license !== "string" || !license) throw new Error(`${pkg.name} declares no license in package.json`);
  const base = { name: pkg.name as string, version: pkg.version as string, license, source: "npm" as const };
  const file = findLicenseFile(dir);
  if (file) return { ...base, text: readFileSync(file, "utf8") };
  const key = `${pkg.name}@${pkg.version}`;
  const override = overrides[key];
  if (!override?.text.trim() || !override.url || override.license !== license) {
    throw new Error(`${key} ships no license file. Add a verified notice to scripts/licenses/npm-notices.json.`);
  }
  return { ...base, ...override };
}

export function prebuiltNoticesForPod(pod: Pod, bundles: PrebuiltNotices): Notice[] {
  const bundle = bundles[pod.name];
  if (!bundle) return [];
  if (bundle.version !== pod.version) {
    throw new Error(
      `Review the bundled notices for ${pod.name}@${pod.version} in scripts/licenses/prebuilt-notices.json.`,
    );
  }
  return bundle.entries.map((entry) => ({ ...entry, source: "bundled" }));
}

const listMarker = /^\s*(?:\d+[.)]|\(?[a-z]\)|[-*•])\s/i;

/** Joins the hard-wrapped lines of each paragraph so license text wraps to the phone width; blank lines and list items stay. */
export function reflow(text: string): string {
  return text
    .replaceAll("\r\n", "\n")
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => {
      const items: string[] = [];
      for (const line of paragraph.split("\n")) {
        const trimmed = line.trim();
        if (items.length === 0 || listMarker.test(line)) items.push(trimmed);
        else items[items.length - 1] += ` ${trimmed}`;
      }
      return items.join("\n");
    })
    .join("\n\n");
}

/** Sorts entries by name, drops duplicate packages, and stores each distinct license text once. */
export function buildNotices(notices: Notice[]): ThirdPartyNotices {
  const texts: string[] = [];
  const indexes = new Map<string, number>();
  const seen = new Set<string>();
  const entries: NoticeEntry[] = [];
  const sorted = [...notices].sort(
    (a, b) =>
      a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || (a.version ?? "").localeCompare(b.version ?? ""),
  );
  for (const { text, ...entry } of sorted) {
    const key = `${entry.name}@${entry.version ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const normalized = reflow(text);
    let index = indexes.get(normalized);
    if (index === undefined) {
      index = texts.length;
      texts.push(normalized);
      indexes.set(normalized, index);
    }
    entries.push({ ...entry, text: index });
  }
  return { entries, texts };
}
