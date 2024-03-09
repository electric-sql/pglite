#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

const postgresJsPath = path.resolve(dirname, "../release/postgres.js");
let postgresJs = fs.readFileSync(postgresJsPath, "utf8");
postgresJs = postgresJs
  .replaceAll(
    `return (
function(Module) {`,
    `return (
function (Module, __dirname, require) {`
  )
  .replace("function doRun()", "async function doRun()")
  .replace(
    'Module["onRuntimeInitialized"]()',
    'await Module["onRuntimeInitialized"](Module)'
  )
  // Fix for Node.js loading wasm files
  .replace(
    "isDataURI(wasmBinaryFile)&&!isFileURI(wasmBinaryFile)",
    "isDataURI(wasmBinaryFile)&&!isFileURI(wasmBinaryFile)&&!ENVIRONMENT_IS_NODE"
  );
fs.writeFileSync(postgresJsPath, postgresJs);
