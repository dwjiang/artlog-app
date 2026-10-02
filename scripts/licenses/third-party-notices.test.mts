import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  parsePodfileLock,
  prebuiltNoticesForPod,
  reflow,
  type PrebuiltNotices,
  type ThirdPartyNotices,
} from "./notices.mts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const notices: ThirdPartyNotices = JSON.parse(readFileSync(join(root, "convex/lib/thirdPartyNotices.json"), "utf8"));
const regenerate = "Run `npm run licenses:generate` after changing dependencies.";
const prebuilt: PrebuiltNotices = JSON.parse(readFileSync(new URL("./prebuilt-notices.json", import.meta.url), "utf8"));

await test("includes the native libraries bundled inside ExpoImage and Skia", () => {
  for (const name of [
    "Skia",
    "SDWebImage",
    "SDWebImageAVIFCoder",
    "SDWebImageSVGCoder",
    "SDWebImageWebPCoder",
    "libavif",
  ]) {
    const entry = notices.entries.find((entry) => entry.name === name);
    assert.ok(entry, `Missing bundled library ${name}`);
    assert.match(notices.texts[entry.text], /copyright/i);
  }
  for (const name of ["expo-image", "@shopify/react-native-skia"]) {
    assert.ok(
      notices.entries.some((entry) => entry.name === name),
      `Missing wrapper ${name}`,
    );
  }
});

await test("includes every curated native notice with its complete text", () => {
  for (const bundle of Object.values(prebuilt)) {
    for (const expected of bundle.entries) {
      const entry = notices.entries.find((entry) => entry.name === expected.name && entry.version === expected.version);
      assert.ok(entry, `Missing bundled library ${expected.name}`);
      assert.equal(notices.texts[entry.text], reflow(expected.text), `${expected.name} lost its license text`);
    }
  }
});

await test("preserves the full notice for the CSS color parser vendored in Skia", () => {
  const header = readFileSync(
    join(root, "node_modules/@shopify/react-native-skia/cpp/api/third_party/CSSColorParser.h"),
    "utf8",
  );
  const sourceNotice = header.match(/^(?:\/\/[^\n]*\n)+/)?.[0];
  assert.ok(sourceNotice, "Missing CSSColorParser license header");
  const entry = notices.entries.find((entry) => entry.name === "css-color-parser-cpp");
  assert.ok(entry, "Missing bundled CSS color parser notice");
  assert.equal(entry.license, "MIT");
  assert.equal(notices.texts[entry.text], reflow(sourceNotice.replaceAll(/^\/\/ ?/gm, "")));
});

await test("includes the Apache license for the OpenCV binary bundled inside FastOpenCV-iOS", () => {
  const entry = notices.entries.find((entry) => entry.name === "OpenCV");
  assert.ok(entry, "Missing bundled OpenCV notice");
  assert.equal(entry.version, "4.9.0");
  assert.equal(entry.license, "Apache-2.0");
  assert.match(notices.texts[entry.text], /^Apache License Version 2\.0, January 2004/);
});

await test("preserves Expo and React Navigation attribution in the bundled router notice", () => {
  const entry = notices.entries.find((entry) => entry.name === "expo-router");
  assert.ok(entry, "Missing Expo Router notice");
  const text = notices.texts[entry.text];
  assert.ok(text.includes("Copyright (c) 2015-present 650 Industries, Inc. (aka Expo)"));
  assert.ok(text.includes("Copyright (c) 2017 React Navigation Contributors"));
});

await test("covers ExpoImage's precompiled Swift package dependencies", () => {
  const config = JSON.parse(readFileSync(join(root, "node_modules/expo-image/spm.config.json"), "utf8"));
  for (const product of config.products) {
    for (const dependency of product.spmPackages) {
      assert.ok(
        prebuilt.ExpoImage.entries.some(
          (entry) => entry.name === dependency.productName && entry.version === dependency.version.exact,
        ),
        `Review the bundled notice for ${dependency.productName}`,
      );
    }
  }
});

await test("preserves copyright notices for packages without a root license file", () => {
  for (const [name, copyright] of [
    ["qrcode-generator", "Copyright (c) 2009 Kazuhiko Arase"],
    ["metro-runtime", "Meta Platforms, Inc. and affiliates"],
    ["@react-native/normalize-colors", "Meta Platforms, Inc. and affiliates"],
  ]) {
    const entry = notices.entries.find((entry) => entry.name === name);
    assert.ok(entry, `Missing ${name}`);
    assert.ok(notices.texts[entry.text].includes(copyright), `${name} lost its copyright notice`);
  }
});

await test("every notice has a stored text and a license", () => {
  for (const entry of notices.entries) {
    assert.ok(entry.license, `${entry.name} has no license`);
    assert.ok(notices.texts[entry.text]?.length, `${entry.name} points at no license text`);
  }
  const keys = notices.entries.map((entry) => `${entry.name}@${entry.version ?? ""}`);
  assert.deepEqual(keys, [...new Set(keys)], "duplicate notices");
});

await test("bundled npm packages match the installed versions", () => {
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")).packages as Record<
    string,
    { version: string }
  >;
  const installed = new Set(
    Object.entries(lock)
      .filter(([path]) => path)
      .map(([path, pkg]) => `${path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length)}@${pkg.version}`),
  );
  const stale = notices.entries
    .filter((entry) => entry.source === "npm" && !installed.has(`${entry.name}@${entry.version}`))
    .map((entry) => `${entry.name}@${entry.version}`);
  assert.deepEqual(stale, [], regenerate);
});

await test("bundled pods match the installed versions", { skip: !existsSync(join(root, "ios/Podfile.lock")) }, () => {
  const installed = parsePodfileLock(readFileSync(join(root, "ios/Podfile.lock"), "utf8"));
  for (const pod of installed) prebuiltNoticesForPod(pod, prebuilt);
  const pods = new Map(installed.map((pod) => [pod.name, pod.version]));
  const stale = notices.entries
    .filter((entry) => entry.source === "pod" && entry.version && pods.get(entry.name) !== entry.version)
    .map((entry) => `${entry.name}@${entry.version}`);
  assert.deepEqual(stale, [], regenerate);
});
