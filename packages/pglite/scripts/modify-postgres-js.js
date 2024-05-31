#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

const postgresJsPath = path.resolve(dirname, "../release/postgres.js");
let postgresJs = fs.readFileSync(postgresJsPath, "utf8");
postgresJs = postgresJs
  // Fix for ReferenceError: asyncifyStubs is not defined
  // see: https://github.com/emscripten-core/emscripten/issues/21104
  // var Module=moduleArg or var Module = moduleArg
  .replace(
    /var Module\s?=\s?moduleArg;/g,
    "var Module = moduleArg; var asyncifyStubs = {};"
  )
  // Make doRun async so we can perform async operations inside onRuntimeInitialized
  .replace("function doRun()", "async function doRun()")
  .replace(
    'Module["onRuntimeInitialized"]()',
    'await Module["onRuntimeInitialized"](Module)'
  )
  // fix name collison between wasi 1.0 proc_exit and postgres specific proc_exit
  .replace(
    "var exitJS",
    "var __wasi_proc_exit = (code) => { throw new ExitStatus(code); }; var exitJS"
  )
  .replace("_proc_exit(status)", "__wasi_proc_exit(status)")
  .replace("proc_exit:_proc_exit,", "proc_exit:__wasi_proc_exit,");
fs.writeFileSync(postgresJsPath, postgresJs);
