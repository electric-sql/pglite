#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

const postgresJsPath = path.resolve(dirname, "../release/postgres.js");
let postgresJs = fs.readFileSync(postgresJsPath, "utf8");
postgresJs = postgresJs.replaceAll(
  `return (
function(Module) {`,
  `return (
function (Module, __dirname, require) {`
);
fs.writeFileSync(postgresJsPath, postgresJs);
