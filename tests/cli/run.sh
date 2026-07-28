#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=${1:?main PGlite repository root is required}
NATIVE=${2:?native PostgreSQL tool directory is required}
OUT=${3:?CLI integration output directory is required}

test -f /.dockerenv || {
  echo 'packed CLI tests must run inside the pinned Docker image' >&2
  exit 1
}
test "$(uname -m)" = aarch64

mkdir -p "${OUT}"
if ! "${REPO_ROOT}/tests/postmaster/build-native-regress-tools.sh" \
  "${REPO_ROOT}" "${NATIVE}" >"${OUT}/native-build.log" 2>&1; then
  tail -n 200 "${OUT}/native-build.log" >&2
  exit 1
fi
tail -n 1 "${OUT}/native-build.log"

pnpm -C "${REPO_ROOT}/packages/pglite" build
pnpm -C "${REPO_ROOT}/packages/pglite-server" build
pnpm -C "${REPO_ROOT}/packages/pglite-tools" build
pnpm -C "${REPO_ROOT}/packages/pglite-cli" build

PGLITE_CLI_INTEGRATION_CONFIG=$(node22 - \
  "${REPO_ROOT}" "${NATIVE}" "${OUT}/run" <<'NODE'
const [repoRoot, nativeRoot, outputRoot] = process.argv.slice(2)
process.stdout.write(JSON.stringify({ repoRoot, nativeRoot, outputRoot }))
NODE
)
export PGLITE_CLI_INTEGRATION_CONFIG

pnpm -C "${REPO_ROOT}/packages/pglite-cli" exec vitest run \
  integration-tests/packed-cli.integration.test.ts \
  --config integration-tests/vitest.config.ts
