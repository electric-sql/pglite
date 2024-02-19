#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

const postgresJsPath = path.resolve(dirname, "../release/share.js");
let postgresJs = fs.readFileSync(postgresJsPath, "utf8");
postgresJs = `var Module = (ModuleBase, require) => {
${postgresJs}
return Module;
};
export default Module;  
`;
fs.writeFileSync(postgresJsPath, postgresJs);
