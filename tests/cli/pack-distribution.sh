#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=${1:?main PGlite repository root is required}
OUT=${2:?packed distribution output directory is required}
PACKS="${OUT}/packs"
PROJECT="${OUT}/project"

test -f /.dockerenv || {
  echo 'the PGlite distribution must be packed inside the pinned Docker image' >&2
  exit 1
}

rm -rf "${OUT}"
mkdir -p "${PACKS}" "${PROJECT}"
for PACKAGE in pglite pglite-server pglite-tools pglite-cli; do
  pnpm -C "${REPO_ROOT}/packages/${PACKAGE}" pack \
    --pack-destination "${PACKS}" >/dev/null
done

node22 - "${PROJECT}/package.json" <<'NODE'
const fs = require('node:fs')
const path = process.argv[2]
fs.writeFileSync(path, `${JSON.stringify({
  name: 'pglite-packed-distribution',
  private: true,
}, null, 2)}\n`)
NODE

mapfile -t ARCHIVES < <(find "${PACKS}" -maxdepth 1 -name '*.tgz' -print | sort)
test "${#ARCHIVES[@]}" -eq 4
npm install --prefix "${PROJECT}" --ignore-scripts --no-audit --no-fund \
  --save-exact "${ARCHIVES[@]}" >/dev/null

CLI="${PROJECT}/node_modules/.bin/pglite"
test -x "${CLI}"
"${CLI}" --version
printf '%s\n' "${CLI}"
