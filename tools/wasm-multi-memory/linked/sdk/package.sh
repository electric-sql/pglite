#!/usr/bin/env bash
# Package an ordinary extension archive with the installed linked wasm32 SDK.
set -euo pipefail
config=${1:?extension config}
input=${2:?raw extension tar.gz}
output=${3:?output archive}
descriptor=${4:?output descriptor}
reports=${5:?report directory}
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/files" "$reports"
python3 - "$input" "$scratch/files" <<'PY'
import sys, tarfile
with tarfile.open(sys.argv[1]) as archive:
    archive.extractall(sys.argv[2], filter="data")
PY
while IFS= read -r -d '' module; do
  pglite-linked-transform "$module" "$module" "$reports/${module#"$scratch/files"/}.json"
done < <(find "$scratch/files" -type f -name '*.so' -print0 | sort -z)
jq '.target.topology = "faceted" | .target.memoryAbi = "pglite-linked-wasm32-v1"' "$config" >"$scratch/faceted.json"
pglite-package-extension "$scratch/faceted.json" "$scratch/files" "$output" "$descriptor"
