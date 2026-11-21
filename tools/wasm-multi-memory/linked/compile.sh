#!/usr/bin/env bash
set -euo pipefail
mkdir -p build/linked
tools=(lower version-loops)
if [[ $# -gt 0 ]]; then tools=("$@"); fi
for tool in "${tools[@]}"; do
  g++ -std=c++17 -O2 -fno-rtti -DBUILD_LLVM_DWARF \
    -I/opt/binaryen/src -I/opt/binaryen/build \
    -I/opt/binaryen/third_party/FP16/include -I/opt/binaryen/third_party/llvm-project/include \
    "tools/wasm-multi-memory/linked/$tool.cpp" \
    -L/opt/binaryen/build/lib -lbinaryen -o "build/linked/${tool##*/}"
done
