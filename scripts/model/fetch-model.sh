#!/usr/bin/env bash
# Downloads the compiled model asset pinned in model-asset.json into the coreml-embed module.
# The destination is gitignored; EAS runs this from the `eas-build-pre-install` hook.
#
#   npm run model:fetch                                       # the pinned release asset
#   MODEL_ASSET_URL=file:///path/to/asset.zip npm run model:fetch   # a locally packaged asset
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
pin="$root/scripts/model/model-asset.json"
models="$root/modules/coreml-embed/ios/Models"
version=$(node -p "require('$pin').modelVersion")
sha256=$(node -p "require('$pin').sha256")
url="${MODEL_ASSET_URL:-$(node -p "require('$pin').url")}"
expected=$(node -p "require('$root/shared/model/model-version.json').modelVersion")
if [ "$version" != "$expected" ]; then
  echo "model-asset.json pins $version but shared/model/model-version.json expects $expected; package a new export first" >&2
  exit 1
fi
if [ "$(cat "$models/.asset-sha256" 2>/dev/null || true)" = "$sha256" ]; then
  echo "Model $version is already in $models"
  exit 0
fi
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
echo "Fetching $url"
if [[ "$url" == https://github.com/*/releases/download/* ]]; then
  node --experimental-strip-types "$root/scripts/model/download-github-asset.ts" "$url" "$tmp/model.zip"
else
  curl -fsSL --retry 3 -o "$tmp/model.zip" "$url"
fi
actual=$(shasum -a 256 "$tmp/model.zip" | cut -d' ' -f1)
if [ "$actual" != "$sha256" ]; then
  echo "Model asset sha256 $actual does not match the pinned $sha256" >&2
  exit 1
fi
rm -rf "$models"
mkdir -p "$models"
unzip -q "$tmp/model.zip" -d "$models"
bundled=$(node -p "require('$models/model-manifest.json').modelVersion")
name=$(node -p "require('$models/model-manifest.json').modelName")
if [ "$bundled" != "$version" ] || [ ! -d "$models/$name.mlmodelc" ]; then
  echo "The asset does not contain $name.mlmodelc for $version" >&2
  rm -rf "$models"
  exit 1
fi
echo "$sha256" > "$models/.asset-sha256"
echo "Model $version ready in $models"
