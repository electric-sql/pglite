import { PGlite } from "../dist/index.js";
import { pgDump } from "../../pglite-tools/dist/pg_dump.js";
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

console.log("Starting...");

const pg = await PGlite.create({ debug: 1 });

for(let i=0; i<9; i++) {
  const rawData = fs.readFileSync(path.resolve(__dirname,`incoming/${i}.raw`))
  try {
    await pg.execProtocolRaw(rawData)
  } catch (e) {
    console.error('caught exception', e)
  }
}