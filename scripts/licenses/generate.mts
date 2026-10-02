import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  buildNotices,
  nearestPackageDir,
  npmNotice,
  packageDirsFromSources,
  parseAcknowledgements,
  parsePodfileLock,
  prebuiltNoticesForPod,
  type LicenseOverrides,
  type Notice,
  type PrebuiltNotices,
} from "./notices.mts";

const root = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, "");
const ios = join(root, "ios");
const output = join(root, "assets/licenses/third-party-notices.json");
const prebuiltNotices: PrebuiltNotices = JSON.parse(
  readFileSync(new URL("./prebuilt-notices.json", import.meta.url), "utf8"),
);
const npmNotices: LicenseOverrides = JSON.parse(readFileSync(new URL("./npm-notices.json", import.meta.url), "utf8"));

function acknowledgementsPlist(): string {
  const targets = join(ios, "Pods/Target Support Files");
  const target = existsSync(targets) ? readdirSync(targets).find((name) => name.startsWith("Pods-")) : undefined;
  const plist = target && join(targets, target, `${target}-acknowledgements.plist`);
  if (!plist || !existsSync(plist)) {
    throw new Error("Missing ios/Podfile.lock or Pods. Run `npx expo prebuild --platform ios` first.");
  }
  return plist;
}

function bundledSources(exportDir: string): string[] {
  execFileSync("npx", ["expo", "export", "--platform", "ios", "--source-maps", "--output-dir", exportDir], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, CI: "1" },
  });
  const maps = join(exportDir, "_expo/static/js/ios");
  return readdirSync(maps)
    .filter((name) => name.endsWith(".map"))
    .flatMap((name) => JSON.parse(readFileSync(join(maps, name), "utf8")).sources as string[]);
}

const plist = acknowledgementsPlist();
mkdirSync(join(root, ".context"), { recursive: true });
const exportDir = mkdtempSync(join(root, ".context/artlog-licenses-"));
try {
  const packageDirs = new Set(packageDirsFromSources(bundledSources(exportDir), root));
  const acknowledged = new Map(parseAcknowledgements(readFileSync(plist, "utf8")).map((entry) => [entry.title, entry]));
  const notices: Notice[] = [];
  for (const pod of parsePodfileLock(readFileSync(join(ios, "Podfile.lock"), "utf8"))) {
    const bundled = prebuiltNoticesForPod(pod, prebuiltNotices);
    notices.push(...bundled);
    const acknowledgement = acknowledged.get(pod.name);
    if (acknowledgement && existsSync(join(ios, "Pods", pod.name))) {
      notices.push({
        name: pod.name,
        version: pod.version,
        license: acknowledgement.license,
        source: "pod",
        text: acknowledgement.text,
      });
    } else if (pod.path) {
      // Keep the wrapper's notice in addition to the licenses of its bundled native libraries.
      const dir = nearestPackageDir(resolve(ios, pod.path));
      if (dir && relative(root, dir).startsWith("node_modules")) packageDirs.add(dir);
    } else if (bundled.length === 0) {
      throw new Error(`No license text for pod ${pod.name}. Add it to scripts/licenses/prebuilt-notices.json.`);
    }
  }
  for (const dir of packageDirs) notices.push(npmNotice(dir, npmNotices));
  const result = buildNotices(notices);
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  execFileSync("npx", ["oxfmt", output], { cwd: root, stdio: "inherit" });
  console.log(`Wrote ${result.entries.length} notices (${result.texts.length} texts) to ${relative(root, output)}`);
} finally {
  rmSync(exportDir, { recursive: true, force: true });
}
