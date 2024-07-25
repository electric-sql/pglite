import test from "ava";
import { PGlite } from "../dist/index.js";
import { live } from "../dist/live/index.js";

test.serial("basic live query", async (t) => {
  const db = new PGlite({
    extensions: { live },
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      number INT
    );
  `);

  await db.exec(`
    INSERT INTO test (number)
    SELECT i*10 FROM generate_series(1, 5) i;
  `);

  let updatedResults;
  const eventTarget = new EventTarget();

  const { initialResults, unsubscribe } = await db.live.query(
    "SELECT * FROM test ORDER BY number;",
    [],
    (result) => {
      updatedResults = result;
      eventTarget.dispatchEvent(new Event("change"));
    }
  );

  t.deepEqual(initialResults.rows, [
    { id: 1, number: 10 },
    { id: 2, number: 20 },
    { id: 3, number: 30 },
    { id: 4, number: 40 },
    { id: 5, number: 50 },
  ]);

  db.exec("INSERT INTO test (number) VALUES (25);");

  await new Promise((resolve) =>
    eventTarget.addEventListener("change", resolve, { once: true })
  );

  t.deepEqual(updatedResults.rows, [
    { id: 1, number: 10 },
    { id: 2, number: 20 },
    { id: 6, number: 25 },
    { id: 3, number: 30 },
    { id: 4, number: 40 },
    { id: 5, number: 50 },
  ]);

  db.exec("DELETE FROM test WHERE id = 6;");

  await new Promise((resolve) =>
    eventTarget.addEventListener("change", resolve, { once: true })
  );

  t.deepEqual(updatedResults.rows, [
    { id: 1, number: 10 },
    { id: 2, number: 20 },
    { id: 3, number: 30 },
    { id: 4, number: 40 },
    { id: 5, number: 50 },
  ]);

  db.exec("UPDATE test SET number = 15 WHERE id = 3;");

  await new Promise((resolve) =>
    eventTarget.addEventListener("change", resolve, { once: true })
  );

  t.deepEqual(updatedResults.rows, [
    { id: 1, number: 10 },
    { id: 3, number: 15 },
    { id: 2, number: 20 },
    { id: 4, number: 40 },
    { id: 5, number: 50 },
  ]);

  unsubscribe();

  db.exec("INSERT INTO test (number) VALUES (35);");

  await new Promise((resolve) => setTimeout(resolve, 100));

  t.deepEqual(updatedResults.rows, [
    { id: 1, number: 10 },
    { id: 3, number: 15 },
    { id: 2, number: 20 },
    { id: 4, number: 40 },
    { id: 5, number: 50 },
  ]);

});

test.serial("basic live incremental query", async (t) => {
  const db = new PGlite({
    extensions: { live },
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      number INT
    );
  `);

  await db.exec(`
    INSERT INTO test (number)
    SELECT i*10 FROM generate_series(1, 5) i;
  `);

  let updatedResults;
  const eventTarget = new EventTarget();

  const { initialResults, unsubscribe } = await db.live.incrementalQuery(
    "SELECT * FROM test ORDER BY number;",
    [],
    "id",
    (result) => {
      updatedResults = result;
      eventTarget.dispatchEvent(new Event("change"));
    }
  );

  t.deepEqual(initialResults.rows, [
    { id: 1, number: 10, __after__: null },
    { id: 2, number: 20, __after__: 1 },
    { id: 3, number: 30, __after__: 2 },
    { id: 4, number: 40, __after__: 3 },
    { id: 5, number: 50, __after__: 4 },
  ]);

  await db.exec("INSERT INTO test (number) VALUES (25);");

  await new Promise((resolve) =>
    eventTarget.addEventListener("change", resolve, { once: true })
  );

  t.deepEqual(updatedResults.rows, [
    { id: 1, number: 10, __after__: null },
    { id: 2, number: 20, __after__: 1 },
    { id: 6, number: 25, __after__: 2 },
    { id: 3, number: 30, __after__: 6 },
    { id: 4, number: 40, __after__: 3 },
    { id: 5, number: 50, __after__: 4 },
  ]);

  await db.exec("DELETE FROM test WHERE id = 6;");

  await new Promise((resolve) =>
    eventTarget.addEventListener("change", resolve, { once: true })
  );

  t.deepEqual(updatedResults.rows, [
    { id: 1, number: 10, __after__: null },
    { id: 2, number: 20, __after__: 1 },
    { id: 3, number: 30, __after__: 2 },
    { id: 4, number: 40, __after__: 3 },
    { id: 5, number: 50, __after__: 4 },
  ]);

  await db.exec("UPDATE test SET number = 15 WHERE id = 3;");

  await new Promise((resolve) =>
    eventTarget.addEventListener("change", resolve, { once: true })
  );

  t.deepEqual(updatedResults.rows, [
    { id: 1, number: 10, __after__: null },
    { id: 3, number: 15, __after__: 1 },
    { id: 2, number: 20, __after__: 3 },
    { id: 4, number: 40, __after__: 2 },
    { id: 5, number: 50, __after__: 4 },
  ]);

  unsubscribe();

  await db.exec("INSERT INTO test (number) VALUES (35);");

  await new Promise((resolve) => setTimeout(resolve, 100));

  t.deepEqual(updatedResults.rows, [
    { id: 1, number: 10, __after__: null },
    { id: 3, number: 15, __after__: 1 },
    { id: 2, number: 20, __after__: 3 },
    { id: 4, number: 40, __after__: 2 },
    { id: 5, number: 50, __after__: 4 },
  ]);
});

test.serial("basic live changes", async (t) => {
  const db = new PGlite({
    extensions: { live },
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      number INT
    );
  `);

  await db.exec(`
    INSERT INTO test (number)
    SELECT i*10 FROM generate_series(1, 5) i;
  `);

  let updatedChanges;
  const eventTarget = new EventTarget();

  const { initialChanges, unsubscribe } = await db.live.changes(
    "SELECT * FROM test ORDER BY number;",
    [],
    "id",
    (changes) => {
      updatedChanges = changes;
      eventTarget.dispatchEvent(new Event("change"));
    }
  );

  t.deepEqual(initialChanges, [
    {
      __op__: "INSERT",
      id: 1,
      number: 10,
      __after__: null,
      __changed_columns__: [],
    },
    {
      __op__: "INSERT",
      id: 2,
      number: 20,
      __after__: 1,
      __changed_columns__: [],
    },
    {
      __op__: "INSERT",
      id: 3,
      number: 30,
      __after__: 2,
      __changed_columns__: [],
    },
    {
      __op__: "INSERT",
      id: 4,
      number: 40,
      __after__: 3,
      __changed_columns__: [],
    },
    {
      __op__: "INSERT",
      id: 5,
      number: 50,
      __after__: 4,
      __changed_columns__: [],
    },
  ]);

  db.exec("INSERT INTO test (number) VALUES (25);");

  await new Promise((resolve) =>
    eventTarget.addEventListener("change", resolve, { once: true })
  );

  t.deepEqual(updatedChanges, [
    {
      __op__: "INSERT",
      id: 6,
      number: 25,
      __after__: 2,
      __changed_columns__: [],
    },
    {
      __after__: 6,
      __changed_columns__: ["__after__"],
      __op__: "UPDATE",
      id: 3,
      number: null,
    },
  ]);

  db.exec("DELETE FROM test WHERE id = 6;");

  await new Promise((resolve) =>
    eventTarget.addEventListener("change", resolve, { once: true })
  );

  t.deepEqual(updatedChanges, [
    {
      __op__: "DELETE",
      id: 6,
      number: null,
      __after__: null,
      __changed_columns__: [],
    },
    {
      __after__: 2,
      __changed_columns__: ["__after__"],
      __op__: "UPDATE",
      id: 3,
      number: null,
    },
  ]);

  db.exec("UPDATE test SET number = 15 WHERE id = 3;");

  await new Promise((resolve) =>
    eventTarget.addEventListener("change", resolve, { once: true })
  );

  t.deepEqual(updatedChanges, [
    {
      id: 2,
      __after__: 3,
      __changed_columns__: ["__after__"],
      __op__: "UPDATE",
      number: null,
    },
    {
      id: 3,
      __after__: 1,
      __changed_columns__: ["number", "__after__"],
      __op__: "UPDATE",
      number: 15,
    },
    {
      id: 4,
      __after__: 2,
      __changed_columns__: ["__after__"],
      __op__: "UPDATE",
      number: null,
    },
  ]);

  unsubscribe();

  db.exec("INSERT INTO test (number) VALUES (35);");

  await new Promise((resolve) => setTimeout(resolve, 100));

  t.deepEqual(updatedChanges, [
    {
      id: 2,
      __after__: 3,
      __changed_columns__: ["__after__"],
      __op__: "UPDATE",
      number: null,
    },
    {
      id: 3,
      __after__: 1,
      __changed_columns__: ["number", "__after__"],
      __op__: "UPDATE",
      number: 15,
    },
    {
      id: 4,
      __after__: 2,
      __changed_columns__: ["__after__"],
      __op__: "UPDATE",
      number: null,
    },
  ]);
});
