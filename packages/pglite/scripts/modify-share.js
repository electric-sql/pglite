#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);
let sharePath = path.resolve(
  dirname,
  "../../../postgres/tmp_install/usr/local/pgsql/share"
);

let bki = fs
  .readFileSync(sharePath + "/postgres.bki", "utf8")
  .replaceAll("NAMEDATALEN", "64")
  .replaceAll("SIZEOF_POINTER", "4")
  .replaceAll("ALIGNOF_POINTER", "i")
  .replaceAll("FLOAT8PASSBYVAL", "false")
  .replaceAll("POSTGRES", "'postgres'")
  .replaceAll("ENCODING", "6") // PG_UTF8
  .replaceAll("LC_COLLATE", "'en_US.UTF-8'")
  .replaceAll("LC_CTYPE", "'en_US.UTF-8'");

fs.writeFileSync(sharePath + "/postgres_wasm.bki", bki);
fs.unlinkSync(sharePath + "/postgres.bki");
