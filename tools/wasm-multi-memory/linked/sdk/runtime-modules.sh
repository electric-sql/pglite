#!/usr/bin/env bash
set -euo pipefail
modules=$1
reports=$2
while IFS= read -r -d '' file; do
  if node20 -e 'try {const m=new WebAssembly.Module(require("fs").readFileSync(process.argv[1]));process.exit(WebAssembly.Module.customSections(m,"pglite.linked-memory.abi").length===1?0:1)}catch{process.exit(1)}' "$file"; then continue; fi
  pglite-linked-transform "$file" "$file" "$reports/${file#"$modules"/}.json" runtime
done < <(find "$modules" -name '*.so' -type f -print0)
