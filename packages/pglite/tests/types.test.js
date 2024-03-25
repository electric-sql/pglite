import test from "ava";
import { types } from "../dist/index.js";

// Parse type tests

test("parse text 25", (t) => {
  t.deepEqual(types.parseType("test", 25), "test");
});

test("parse varchar 1043", (t) => {
  t.deepEqual(types.parseType("test", 1043), "test");
});

test("parse int2 21", (t) => {
  t.deepEqual(types.parseType("1", 21), 1);
});

test("parse int4 23", (t) => {
  t.deepEqual(types.parseType("1", 23), 1);
});

test("parse oid 26", (t) => {
  t.deepEqual(types.parseType("1", 26), 1);
});

test("parse float4 700", (t) => {
  t.deepEqual(types.parseType("1.1", 700), 1.1);
});

test("parse float8 701", (t) => {
  t.deepEqual(types.parseType("1.1", 701), 1.1);
});

test("parse int8 20", (t) => {
  t.deepEqual(types.parseType("1", 20), 1n);
});

test("parse json 114", (t) => {
  t.deepEqual(types.parseType('{"test":1}', 114), { test: 1 });
});

test("parse jsonb 3802", (t) => {
  t.deepEqual(types.parseType('{"test":1}', 3802), { test: 1 });
});

test("parse bool 16", (t) => {
  t.deepEqual(types.parseType("t", 16), true);
});

test("parse date 1082", (t) => {
  t.deepEqual(
    types.parseType("2021-01-01", 1082),
    new Date("2021-01-01T00:00:00.000Z")
  );
});

test("parse timestamp 1114", (t) => {
  t.deepEqual(
    types.parseType("2021-01-01T12:00:00", 1114),
    new Date("2021-01-01T12:00:00.000Z")
  );
});

test("parse timestamptz 1184", (t) => {
  t.deepEqual(
    types.parseType("2021-01-01T12:00:00", 1184),
    new Date("2021-01-01T12:00:00.000Z")
  );
});

test("parse bytea 17", (t) => {
  t.deepEqual(types.parseType("\\x010203", 17), Uint8Array.from([1, 2, 3]));
});

test("parse unknown", (t) => {
  t.deepEqual(types.parseType("test", 0), "test");
});

// Serialize type tests

test("serialize string", (t) => {
  t.deepEqual(types.serializeType("test"), ["test", 25]);
});

test("serialize number", (t) => {
  t.deepEqual(types.serializeType(1), ["1", 0]);
  t.deepEqual(types.serializeType(1.1), ["1.1", 0]);
});

test("serialize bigint", (t) => {
  t.deepEqual(types.serializeType(1n), ["1", 20]);
});

test("serialize bool", (t) => {
  t.deepEqual(types.serializeType(true), ["t", 16]);
});

test("serialize date", (t) => {
  t.deepEqual(types.serializeType(new Date("2021-01-01T00:00:00.000Z")), [
    "2021-01-01T00:00:00.000Z",
    1184,
  ]);
});

test("serialize json", (t) => {
  t.deepEqual(types.serializeType({ test: 1 }), ['{"test":1}', 114]);
});

test("serialize blob", (t) => {
  t.deepEqual(types.serializeType(Uint8Array.from([1, 2, 3])), [
    "\\x010203",
    17,
  ]);
});
