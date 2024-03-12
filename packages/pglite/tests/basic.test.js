import test from "ava";
import { PGlite } from "../dist/index.js";

test(`basic exec`, async (t) => {
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

test(`basic query`, async (t) => {
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

test(`basic types`, async (t) => {
  const db = new PGlite();
  await db.query(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      text TEXT,
      number INT,
      float FLOAT,
      bool BOOLEAN,
      date DATE,
      timestamp TIMESTAMP,
      json JSONB
    );
  `);
  
  await db.query(`
    INSERT INTO test (text, number, float, bool, date, timestamp, json) 
    VALUES ($1, $2, $3, $4, $5, $6, $7);
  `, [
    "test",
    1,
    1.5,
    true,
    new Date("2021-01-01"),
    new Date("2021-01-01T12:00:00"),
    { test: "test" }
  ]);

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
        bool: true,
        date: new Date("2021-01-01T00:00:00.000Z"),
        timestamp: new Date("2021-01-01T12:00:00.000Z"),
        json: { test: "test" }
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
    ],
    affectedRows: 0,
  });
});
