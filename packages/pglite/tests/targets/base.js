import test from "../polytest.js";
import playwright from "playwright";

const wsPort = process.env.WS_PORT || 3334;

export function tests(env, dbFilename, target) {
  let browser;
  let evaluate;
  let page;
  let db;

  test.before(async (t) => {
    if (env !== "node") {
      browser = await playwright[env].launch();
    }
  });

  test.after(async (t) => {
    if (browser) {
      await browser.close();
    }
  });

  test.serial.before(async (t) => {
    if (env === "node") {
      evaluate = async (fn) => fn();
    } else {
      const context = await browser.newContext();
      page = await context.newPage();
      await page.goto(`http://localhost:${wsPort}/tests/blank.html`);
      page.evaluate(`window.dbFilename = "${dbFilename}";`);
      evaluate = async (fn) => await page.evaluate(fn);
    }
  });

  test.serial(`targets ${target} basic`, async (t) => {
    const res = await evaluate(async () => {
      const { PGlite } = await import("../../dist/index.js");
      db = new PGlite(dbFilename);
      await db.waitReady;
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
      return res;
    });

    t.deepEqual(res, {
      affectedRows: 0,
      fields: [
        {
          dataTypeID: 23,
          name: "id",
        },
        {
          dataTypeID: 25,
          name: "name",
        },
      ],
      rows: [
        {
          id: 1,
          name: "test",
        },
      ],
    });
  });

  test.serial(`targets ${target} params`, async (t) => {
    const res = await evaluate(async () => {
      await db.query("INSERT INTO test (name) VALUES ($1);", ["test2"]);
      const res = await db.query(`
          SELECT * FROM test;
        `);
      return res;
    });

    t.deepEqual(res, {
      affectedRows: 0,
      fields: [
        {
          dataTypeID: 23,
          name: "id",
        },
        {
          dataTypeID: 25,
          name: "name",
        },
      ],
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
    });
  });

  if (dbFilename === "memory://") {
    // Skip the rest of the tests for memory:// as it's not persisted
    return;
  }

  test.serial(`targets ${target} persisted`, async (t) => {
    await page?.reload(); // Refresh the page
    page?.evaluate(`window.dbFilename = "${dbFilename}";`);

    const res = await evaluate(async () => {
      const { PGlite } = await import("../../dist/index.js");
      const db = new PGlite(dbFilename);
      await db.waitReady;
      const res = await db.query(`
          SELECT * FROM test;
        `);
      return res;
    });

    t.deepEqual(res, {
      affectedRows: 0,
      fields: [
        {
          dataTypeID: 23,
          name: "id",
        },
        {
          dataTypeID: 25,
          name: "name",
        },
      ],
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
    });
  });
}
