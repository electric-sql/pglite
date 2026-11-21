#!/usr/bin/env bash
# From a linked SDK build, qualify both postmasters against the pinned PostgreSQL schedules.
set -euo pipefail
dir=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$dir/../../../.." && pwd)
sdk=$(cd "${1:?linked SDK output directory}" && pwd)
out=${2:-$root/build/linked/qualification}
mkdir -p "$out/sources"
out=$(cd "$out" && pwd)
source "$root/tools/wasm-multi-memory/toolchain.env"
tag="$PGLITE_EMSDK_VERSION-$PGLITE_MULTI_MEMORY_IMAGE_REVISION"
linked=${PGLITE_LINKED_IMAGE:-pglite-linked-sdk:$tag}
native=${PGLITE_MULTI_MEMORY_IMAGE:-pglite-multi-memory-shared-tools:$tag}
pin=$(git -C "$root" rev-parse HEAD:postgres-pglite)
pg="$root/postgres-pglite"
test "$(git -C "$pg" rev-parse HEAD)" = "$pin"
git -C "$pg" diff --quiet HEAD -- src pglite/src/pglitec
git -C "$pg" archive -o "$out/sources/postgres.tar" "$pin"
tool_volume="pglite-qualification-native-tools"
git_dir=$(git -C "$pg" rev-parse --path-format=absolute --git-common-dir)
docker run --rm -v "$root:$root:ro" -v "$git_dir:$git_dir:ro" -v "$tool_volume:/native" \
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e 'GIT_CONFIG_VALUE_0=*' \
  "$native" bash "$root/tests/postmaster/build-native-regress-tools.sh" "$root" /native >"$out/tools.log" 2>&1
run_mode() (
  set -euo pipefail
  mode=$1
  failed=0
  image=$linked
  if [[ $mode == native ]]; then image=$native; fi
  mkdir -p "$out/$mode"
  common=(--rm -w /work -v "$root:/work:ro" -v "$out/$mode:/out")
  docker run "${common[@]}" -v /build -v "$out/sources:/sources:ro" -v "$sdk/classic:/classic:ro" \
    -e "PGLITE_BUILD_JOBS=${PGLITE_BUILD_JOBS:-6}" "$image" \
    bash tools/wasm-multi-memory/linked/qualification/regression-core.sh "$mode" >"$out/$mode-build.log" 2>&1
  js_volume=$(docker volume create)
  for phase in prepare scenarios schedules stress; do
    if ! docker run "${common[@]}" -v "$js_volume:/build" -v "$tool_volume:/native:ro" -v "$sdk:/sdk:ro" \
        -v pglite-multi-memory-pnpm-store:/tmp/pnpm-store "$linked" \
        bash tools/wasm-multi-memory/linked/qualification/verify-postgres.sh "$mode" "$phase" >"$out/$mode-$phase.log" 2>&1; then
      echo "$mode $phase failed; see $out/$mode-$phase.log" >&2
      failed=1
      if [[ $phase == prepare ]]; then break; fi
    fi
  done
  docker volume rm "$js_volume" >/dev/null
  exit "$failed"
)
if [[ ${PGLITE_QUALIFICATION_PARALLEL:-false} == true ]]; then
  run_mode linked &
  linked_pid=$!
  run_mode native &
  native_pid=$!
  status=0
  wait "$linked_pid" || status=1
  wait "$native_pid" || status=1
  exit "$status"
fi
status=0
run_mode linked &
wait "$!" || status=1
run_mode native &
wait "$!" || status=1
exit "$status"
