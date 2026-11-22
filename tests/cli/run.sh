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

# Exercise the linked distribution on Node 20, including child CLIs
# which use /usr/bin/env node rather than inheriting process.execPath.
topology=$(node22 -p 'require(process.argv[1]).artifacts.postmaster.memoryTopology' \
  "${REPO_ROOT}/packages/pglite/release/runtime-identity.json")
if [[ ${topology} == faceted ]]; then
  node20_bin=$(dirname "$(readlink -f "$(command -v node20)")")
  PATH="${node20_bin}:${PATH}" node20 \
    "${REPO_ROOT}/packages/pglite-cli/integration-tests/scenarios/packed-cli.mjs" \
    "${REPO_ROOT}" "${NATIVE}" "${OUT}/node20"
fi
