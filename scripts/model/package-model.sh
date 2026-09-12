#!/usr/bin/env bash
# Compiles the exported package for the phone, zips it with its manifest as the release asset,
# and pins that asset's URL and sha256 in model-asset.json for fetch-model.sh.
#
#   scripts/model/package-model.sh [out-dir]
set -euo pipefail
cd "$(dirname "$0")"
out="${1:-out}"
manifest="$out/model-manifest.json"
if [ ! -f "$manifest" ]; then
  echo "No $manifest; run \`uv run python export_coreml.py --out $out\` first" >&2
  exit 1
fi
version=$(node -p "require('./$manifest').modelVersion")
name=$(node -p "require('./$manifest').modelName")
rm -rf "$out/compiled"
xcrun coremlcompiler compile "$out/$name.mlpackage" "$out/compiled"
cp "$manifest" "$out/compiled/"
asset="$name-$version.zip"
rm -f "$out/$asset"
(cd "$out/compiled" && zip -qr "../$asset" "$name.mlmodelc" model-manifest.json)
sha256=$(shasum -a 256 "$out/$asset" | cut -d' ' -f1)
node -e "
require('fs').writeFileSync('model-asset.json', JSON.stringify({
  modelVersion: '$version',
  url: 'https://github.com/dwjiang/artlog-app/releases/download/model-$version/$asset',
  sha256: '$sha256',
}, null, 2) + '\n');
"
echo "$out/$asset $sha256"
