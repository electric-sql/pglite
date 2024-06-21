#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const pg_config_h_path = path.resolve(
  __dirname,
  "../tmp_install/usr/include/server/pg_config.h"
);

let pg_config_h = fs.readFileSync(pg_config_h_path, "utf-8");

const old_version = process.argv[2];
const new_version = process.argv[3];

pg_config_h = pg_config_h.replace(
  `PG_VERSION_NUM ${old_version}`,
  `PG_VERSION_NUM ${new_version}`
);

fs.writeFileSync(pg_config_h_path, pg_config_h);
