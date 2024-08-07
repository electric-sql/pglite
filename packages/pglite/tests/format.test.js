import test from "ava";
import { PGlite, formatQuery } from "../dist/index.js";

let pg;

test.before(async () => {
  pg = await PGlite.create();
});

test.serial("format boolean", async (t) => {
  const ret1 = await formatQuery(pg, "SELECT * FROM test WHERE value = $1;", [true]);
  t.is(ret1, "SELECT * FROM test WHERE value = 't';");
});

test.serial("format number", async (t) => {
  const ret2 = await formatQuery(pg, "SELECT * FROM test WHERE value = $1;", [1]);
  t.is(ret2, "SELECT * FROM test WHERE value = '1';");
});

test.serial("format string", async (t) => {
  const ret3 = await formatQuery(pg, "SELECT * FROM test WHERE value = $1;", ["test"]);
  t.is(ret3, "SELECT * FROM test WHERE value = 'test';");
});

test.serial("format json", async (t) => {
  const ret4 = await formatQuery(pg, "SELECT * FROM test WHERE value = $1;", [{ test: "test" }]);
  t.is(ret4, "SELECT * FROM test WHERE value = '{\"test\":\"test\"}';");
});
