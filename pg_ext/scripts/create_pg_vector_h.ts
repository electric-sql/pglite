import { $ } from "bun";

const src = new URL("../pgvector/src", import.meta.url).pathname;
console.log(src);
const c_src_files = (await $`cd ${src} && ls *.c`.text())
  .split("\n")
  .filter((fname) => fname.length != 0);

let syms: string[] = [];
let decls: string[] = [];

for (const _c_src_file of c_src_files) {
  const c_src_file = new URL(`../pgvector/src/${_c_src_file}`, import.meta.url)
    .pathname;
  const c_src = await $`cat ${c_src_file}`.text();
  const src_lines = c_src.split("\n");
  for (const src_line of src_lines) {
    if (src_line.includes("PGDLLEXPORT")) {
      const sym = src_line
        .replace("PGDLLEXPORT ", "")
        .replace("PG_FUNCTION_INFO_V1(", "")
        .replace(");", "")
        .replace("(PG_FUNCTION_ARGS", "")
        .replace("Datum", "")
        .trim();

      if (sym.includes("pgvector_PG_init")) {
        continue;
      }

      syms.push(sym);
      decls.push(
        src_line.replace("PG_FUNCTION_INFO_V1", "PGlite_FUNCTION_INFO_V1")
      );
    }
  }
}

console.log('#include "postgres.h"');
console.log('#include "pglite_ext_util.h"');
console.log();
console.log("extern void _PG_init(void);");

for (const decl of decls) {
  console.log(decl);
}

console.log();

console.log("#####  Func Table  #####");

for (let i = 0; i < syms.length; i++) {
  const sym = syms[i];
  const decl = decls[i];
  console.log(`{"${sym}", ${sym}},`);
  if (decl.includes("PGlite_FUNCTION_INFO_V1")) {
    console.log(`{"pg_finfo_${sym}", pg_finfo_${sym}},`);
  }
}
