#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const fmgr_h_path = path.resolve(
  __dirname,
  "../tmp_install/usr/include/server/fmgr.h"
);

let fmgr_h = fs.readFileSync(fmgr_h_path, "utf-8");

fmgr_h = fmgr_h.replace(
  "#define PG_MODULE_MAGIC \\",
  "#define PG_MODULE_MAGIC static int I_WILL_DIE_IN_DCE = 0; // \\"
);

fs.writeFileSync(fmgr_h_path, fmgr_h);
