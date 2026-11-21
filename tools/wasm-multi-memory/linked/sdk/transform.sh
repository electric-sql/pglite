#!/usr/bin/env bash
# Transform an ordinary Emscripten side module or the postmaster main module.
set -euo pipefail
input=${1:?input Wasm}
output=${2:?output Wasm}
report=${3:?compiler report}
kind=${4:-extension}
sdk=/opt/pglite-linked
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
flags=(--provenance --inline-private-fast-path --global-initial-pages 2 --global-maximum-pages 16384)
for feature in atomics mutable-globals sign-ext bulk-memory bulk-memory-opt; do
  flags+=(--enable-feature "$feature")
done
case "$kind" in
  main)
    flags+=(--wasm-shadow-stack-frame-bytes 1024 --private-identity-export pgl_private_pointer)
    node22 -e 'const m=new WebAssembly.Module(require("fs").readFileSync(process.argv[1])); console.log(WebAssembly.Module.exports(m).filter(x=>x.kind==="function").map(x=>x.name).join("\n"))' "$input" >"$scratch/exports"
    while read -r name; do
      if grep -Fxq "$name" "$scratch/exports"; then flags+=(--private-return-export "$name"); fi
    done <"$sdk/private-return-exports.txt"
    ;;
  extension|runtime) ;;
  *) echo "unknown module kind $kind" >&2; exit 2;;
esac
mkdir -p "$(dirname "$report")" "$(dirname "$output")"
hash=$(sha256sum "$input" | cut -d' ' -f1)
pglite-wasm-multi-memory "$input" --output "$scratch/domain.wasm" --report "$report" --input-sha256 "$hash" "${flags[@]}"
wasm-opt --all-features -O3 "$scratch/domain.wasm" -o "$scratch/optimized.wasm"
intermediate="$scratch/optimized.wasm"
if ! node22 -e 'const m=new WebAssembly.Module(require("fs").readFileSync(process.argv[1]));process.exit(WebAssembly.Module.imports(m).filter(x=>x.kind==="memory").length===3?0:1)' "$intermediate"; then
  intermediate="$scratch/domain.wasm"
fi
if [[ $kind == extension ]]; then
  "$sdk/version-loops" "$intermediate" "$scratch/versioned.wasm" --ordered-linked
  intermediate="$scratch/versioned.wasm"
fi
"$sdk/lower" --sdk "$intermediate" "$scratch/lowered.wasm"
if [[ $kind == extension ]]; then
  wasm-opt --all-features -O3 "$scratch/lowered.wasm" -o "$scratch/final.wasm"
else
  mv "$scratch/lowered.wasm" "$scratch/final.wasm"
fi
node20 -e 'const m=new WebAssembly.Module(require("fs").readFileSync(process.argv[1])); const a=WebAssembly.Module.imports(m).filter(x=>x.kind==="memory"); if(a.length!==1||a[0].module!=="env"||a[0].name!=="memory"||WebAssembly.Module.customSections(m,"pglite.linked-memory.abi").length!==1) throw Error("invalid linked module")' "$scratch/final.wasm"
install -m 755 "$scratch/final.wasm" "$output"
