import test from "ava";
import { PGlite } from "../dist/index.js";

test("basic exec", async (t) => {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      name TEXT
    );
  `);
  await db.exec("INSERT INTO test (name) VALUES ('test');");
  const res = await db.exec(`
    SELECT * FROM test;
  `);

  t.deepEqual(res, [
    {
      rows: [
        {
          id: 1,
          name: "test",
        },
      ],
      fields: [
        {
          name: "id",
          dataTypeID: 23,
        },
        {
          name: "name",
          dataTypeID: 25,
        },
      ],
      affectedRows: 0,
    },
  ]);
});

test("basic query", async (t) => {
  const db = new PGlite();
  await db.query(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      name TEXT
    );
  `);
  await db.query("INSERT INTO test (name) VALUES ('test');");
  const res = await db.query(`
    SELECT * FROM test;
  `);

  t.deepEqual(res, {
    rows: [
      {
        id: 1,
        name: "test",
      },
    ],
    fields: [
      {
        name: "id",
        dataTypeID: 23,
      },
      {
        name: "name",
        dataTypeID: 25,
      },
    ],
    affectedRows: 0,
  });
});

test("basic types", async (t) => {
  const db = new PGlite();
  await db.query(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      text TEXT,
      number INT,
      float FLOAT,
      bigint BIGINT,
      bool BOOLEAN,
      date DATE,
      timestamp TIMESTAMP,
      json JSONB,
      blob BYTEA
    );
  `);

  await db.query(
    `
    INSERT INTO test (text, number, float, bigint, bool, date, timestamp, json, blob)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
  `,
    [
      "test",
      1,
      1.5,
      9223372036854775807n,
      true,
      new Date("2021-01-01"),
      new Date("2021-01-01T12:00:00"),
      { test: "test" },
      Uint8Array.from([1, 2, 3]),
    ]
  );

  const res = await db.query(`
    SELECT * FROM test;
  `);

  t.deepEqual(res, {
    rows: [
      {
        id: 1,
        text: "test",
        number: 1,
        float: 1.5,
        bigint: 9223372036854775807n,
        bool: true,
        date: new Date("2021-01-01T00:00:00.000Z"),
        timestamp: new Date("2021-01-01T12:00:00.000Z"),
        json: { test: "test" },
        blob: Uint8Array.from([1, 2, 3]),
      },
    ],
    fields: [
      {
        name: "id",
        dataTypeID: 23,
      },
      {
        name: "text",
        dataTypeID: 25,
      },
      {
        name: "number",
        dataTypeID: 23,
      },
      {
        name: "float",
        dataTypeID: 701,
      },
      {
        name: "bigint",
        dataTypeID: 20,
      },
      {
        name: "bool",
        dataTypeID: 16,
      },
      {
        name: "date",
        dataTypeID: 1082,
      },
      {
        name: "timestamp",
        dataTypeID: 1114,
      },
      {
        name: "json",
        dataTypeID: 3802,
      },
      {
        name: "blob",
        dataTypeID: 17,
      },
    ],
    affectedRows: 0,
  });
});

test("basic params", async (t) => {
  const db = new PGlite();
  await db.query(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      name TEXT
    );
  `);
  await db.query("INSERT INTO test (name) VALUES ($1);", ["test2"]);
  const res = await db.query(`
    SELECT * FROM test;
  `);

  t.deepEqual(res, {
    rows: [
      {
        id: 1,
        name: "test2",
      },
    ],
    fields: [
      {
        name: "id",
        dataTypeID: 23,
      },
      {
        name: "name",
        dataTypeID: 25,
      },
    ],
    affectedRows: 0,
  });
});

test("basic error", async (t) => {
  const db = new PGlite();
  await t.throwsAsync(
    async () => {
      await db.query("SELECT * FROM test;");
    },
    {
      message: 'relation "test" does not exist',
    }
  );
});

test("basic transaction", async (t) => {
  const db = new PGlite();
  await db.query(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      name TEXT
    );
  `);
  await db.query("INSERT INTO test (name) VALUES ('test');");
  await db.transaction(async (tx) => {
    await tx.query("INSERT INTO test (name) VALUES ('test2');");
    const res = await tx.query(`
      SELECT * FROM test;
    `);
    t.deepEqual(res, {
      rows: [
        {
          id: 1,
          name: "test",
        },
        {
          id: 2,
          name: "test2",
        },
      ],
      fields: [
        {
          name: "id",
          dataTypeID: 23,
        },
        {
          name: "name",
          dataTypeID: 25,
        },
      ],
      affectedRows: 0,
    });
    await tx.rollback();
  });
  const res = await db.query(`
    SELECT * FROM test;
  `);
  t.deepEqual(res, {
    rows: [
      {
        id: 1,
        name: "test",
      },
    ],
    fields: [
      {
        name: "id",
        dataTypeID: 23,
      },
      {
        name: "name",
        dataTypeID: 25,
      },
    ],
    affectedRows: 0,
  });
});
