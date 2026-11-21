#!/usr/bin/env bash
set -euo pipefail
exec emcc -O2 -m32 -fPIC -sSIDE_MODULE=1 -sWASM_BIGINT -sSUPPORT_LONGJMP=emscripten \
  -I/opt/pglite-linked/include/postgresql/server "$@"
