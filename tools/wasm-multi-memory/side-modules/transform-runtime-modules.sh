#!/usr/bin/env bash
set -euo pipefail

MODULE_DIR=${1:?installed PostgreSQL module directory is required}
REPORT_ROOT=${2:?runtime module report directory is required}

test -f /.dockerenv || {
  echo 'PGlite runtime modules must be transformed inside the pinned Docker image' >&2
  exit 1
}
command -v node22 >/dev/null
test -d "${MODULE_DIR}"

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
if [ -x "${SCRIPT_DIR}/transform-side-module.sh" ]; then
  TRANSFORMER="${SCRIPT_DIR}/transform-side-module.sh"
else
  TRANSFORMER=$(command -v pglite-transform-side-module)
fi

RAW_ROOT="${REPORT_ROOT}/raw"
OUTPUT_ROOT="${REPORT_ROOT}/transformed"
mkdir -p "${RAW_ROOT}" "${OUTPUT_ROOT}"

is_transformed() {
  node22 - "$1" <<'NODE'
const fs = require('node:fs')
const module = new WebAssembly.Module(fs.readFileSync(process.argv[2]))
const sections = WebAssembly.Module.customSections(
  module,
  'pglite.multi-memory.abi',
)
process.exit(sections.length === 1 ? 0 : 1)
NODE
}

mapfile -d '' MODULES < <(
  find "${MODULE_DIR}" -type f -name '*.so' -print0 | sort -z
)
test "${#MODULES[@]}" -gt 0 || {
  echo "no PostgreSQL runtime modules found under ${MODULE_DIR}" >&2
  exit 1
}

TRANSFORMED=0
REUSED=0
for module in "${MODULES[@]}"; do
  relative=${module#"${MODULE_DIR}/"}
  stem=${relative%.so}
  raw="${RAW_ROOT}/${stem}.raw.so"
  output="${OUTPUT_ROOT}/${relative}"
  report="${OUTPUT_ROOT}/${stem}.report.json"
  audit="${OUTPUT_ROOT}/${stem}.audit.json"

  if is_transformed "${module}"; then
    REUSED=$((REUSED + 1))
    continue
  fi

  mkdir -p "$(dirname -- "${raw}")" "$(dirname -- "${output}")"
  cp "${module}" "${raw}"
  "${TRANSFORMER}" \
    "${raw}" "${output}" "${report}" "${audit}"
  install -m 755 "${output}" "${module}"
  TRANSFORMED=$((TRANSFORMED + 1))
done

printf 'PGlite runtime side modules: transformed=%d reused=%d total=%d\n' \
  "${TRANSFORMED}" "${REUSED}" "${#MODULES[@]}"
