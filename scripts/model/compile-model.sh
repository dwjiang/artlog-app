#!/usr/bin/env bash
# Compiles an export into the app's tracked Git LFS model directory.
#
#   scripts/model/compile-model.sh [out-dir]
set -euo pipefail
cd "$(dirname "$0")"
out="${1:-out}"
manifest="$out/model-manifest.json"
if [ ! -f "$manifest" ]; then
  echo "No $manifest; run \`uv run python export_coreml.py --out $out\` first" >&2
  exit 1
fi
name=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).modelName)' "$manifest")
compiled=$(mktemp -d)
trap 'rm -rf "$compiled"' EXIT
xcrun coremlcompiler compile "$out/$name.mlpackage" "$compiled"
cp "$manifest" "$compiled/"
node --experimental-strip-types check-model.mts "$compiled"
models="../../modules/coreml-embed/ios/Models"
rm -rf "$models"
mkdir -p "$models"
cp -R "$compiled/." "$models/"
echo "Compiled model ready. Commit $models with Git LFS."
