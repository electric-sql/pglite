#!/usr/bin/env bash
# The built-in pgoutput plugin uses a backend Makefile outside PGXS.
# Give it the same import collection as separately shipped extensions.
set -euo pipefail
dir="$INSTALL_FOLDER/include/postgresql/emscripten/extension/imports"
"${LLVM_NM:-/emsdk/upstream/bin/llvm-nm}" --undefined-only src/backend/replication/pgoutput/pgoutput.o \
  | awk '$1 == "U" { print $2 }' | sort -u >"$dir/pgoutput.imports"
emmake make PORTNAME=emscripten -C src/backend pglite-owned-exports
