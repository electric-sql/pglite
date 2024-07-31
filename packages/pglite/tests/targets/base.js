import test from "../polytest.js";
import playwright from "playwright";

const wsPort = process.env.WS_PORT || 3334;

export function tests(env, dbFilename, target) {
  let browser;
  let evaluate;
  let context;
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
      context = await browser.newContext();
      page = await context.newPage();
      await page.goto(`http://localhost:${wsPort}/tests/blank.html`);
      page.evaluate(`window.dbFilename = "${dbFilename}";`);
      page.on("console", (msg) => {
        console.log(msg);
      });
      evaluate = async (fn) => {
        try {
          return await page.evaluate(fn);
        } catch (e) {
          console.error(e);
          throw e;
        }
      };
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

  if (env === "node") {
    // Skip the rest of the tests for node as they are browser specific
    return;
  }

  test.serial(`targets ${target} worker live query`, async (t) => {
    const page2 = await context.newPage();
    await page2.goto(`http://localhost:${wsPort}/tests/blank.html`);
    page2.evaluate(`window.dbFilename = "${dbFilename}";`);
    page.on("console", (msg) => {
      console.log(msg);
    });

    const res2Prom = page2.evaluate(async () => {
      const { live } = await import("../../dist/live/index.js");
      const { PGliteWorker } = await import("../../dist/worker/index.js");

      let db;
      db = new PGliteWorker(
        new Worker("/tests/targets/worker.js", {
          type: "module",
        }),
        {
          dataDir: window.dbFilename,
          extensions: { live },
        }
      );

      await db.waitReady;

      let updatedResults;
      const eventTarget = new EventTarget();
      const { initialResults, unsubscribe } = await db.live.query(
        "SELECT * FROM test ORDER BY name;",
        [],
        (result) => {
          updatedResults = result;
          eventTarget.dispatchEvent(new Event("updated"));
        }
      );
      await new Promise((resolve) => {
        eventTarget.addEventListener("updated", resolve);
      });
      return { initialResults, updatedResults };
    });

    const res1 = await evaluate(async () => {
      const { live } = await import("../../dist/live/index.js");
      const { PGliteWorker } = await import("../../dist/worker/index.js");

      let db;
      db = new PGliteWorker(
        new Worker("/tests/targets/worker.js", {
          type: "module",
        }),
        {
          dataDir: window.dbFilename,
          extensions: { live },
        }
      );

      await db.waitReady;

      let updatedResults;
      const eventTarget = new EventTarget();
      const { initialResults, unsubscribe } = await db.live.query(
        "SELECT * FROM test ORDER BY name;",
        [],
        (result) => {
          updatedResults = result;
          eventTarget.dispatchEvent(new Event("updated"));
        }
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      await db.query("INSERT INTO test (id, name) VALUES (3, 'test3');");
      await new Promise((resolve) => {
        eventTarget.addEventListener("updated", resolve);
      });
      return { initialResults, updatedResults };
    });

    const res2 = await res2Prom;

    t.deepEqual(res1.initialResults.rows, [
      {
        id: 1,
        name: "test",
      },
      {
        id: 2,
        name: "test2",
      },
    ]);

    for (const res of [res1, res2]) {
      t.deepEqual(res.updatedResults.rows, [
        {
          id: 1,
          name: "test",
        },
        {
          id: 2,
          name: "test2",
        },
        {
          id: 3,
          name: "test3",
        },
      ]);
    }
  });

  test.serial(`targets ${target} worker live incremental query`, async (t) => {
    const page2 = await context.newPage();
    await page2.goto(`http://localhost:${wsPort}/tests/blank.html`);
    page2.evaluate(`window.dbFilename = "${dbFilename}";`);
    page.on("console", (msg) => {
      console.log(msg);
    });

    const res2Prom = page2.evaluate(async () => {
      const { live } = await import("../../dist/live/index.js");
      const { PGliteWorker } = await import("../../dist/worker/index.js");

      let db;
      db = new PGliteWorker(
        new Worker("/tests/targets/worker.js", {
          type: "module",
        }),
        {
          dataDir: window.dbFilename,
          extensions: { live },
        }
      );

      await db.waitReady;

      let updatedResults;
      const eventTarget = new EventTarget();
      const { initialResults, unsubscribe } = await db.live.incrementalQuery(
        "SELECT * FROM test ORDER BY name;",
        [],
        "id",
        (result) => {
          updatedResults = result;
          eventTarget.dispatchEvent(new Event("updated"));
        }
      );
      await new Promise((resolve) => {
        eventTarget.addEventListener("updated", resolve);
      });
      return { initialResults, updatedResults };
    });

    const res1 = await evaluate(async () => {
      const { live } = await import("../../dist/live/index.js");
      const { PGliteWorker } = await import("../../dist/worker/index.js");

      let db;
      db = new PGliteWorker(
        new Worker("/tests/targets/worker.js", {
          type: "module",
        }),
        {
          dataDir: window.dbFilename,
          extensions: { live },
        }
      );

      await db.waitReady;

      let updatedResults;
      const eventTarget = new EventTarget();
      const { initialResults, unsubscribe } = await db.live.incrementalQuery(
        "SELECT * FROM test ORDER BY name;",
        [],
        "id",
        (result) => {
          updatedResults = result;
          eventTarget.dispatchEvent(new Event("updated"));
        }
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      const ret = await db.query(
        "INSERT INTO test (id, name) VALUES (4, 'test4');"
      );
      await new Promise((resolve) => {
        eventTarget.addEventListener("updated", resolve);
      });
      return { initialResults, updatedResults };
    });

    const res2 = await res2Prom;

    t.deepEqual(res1.initialResults.rows, [
      {
        __after__: null,
        id: 1,
        name: "test",
      },
      {
        __after__: 1,
        id: 2,
        name: "test2",
      },
      {
        __after__: 2,
        id: 3,
        name: "test3",
      },
    ]);

    for (const res of [res1, res2]) {
      t.deepEqual(res.updatedResults.rows, [
        {
          __after__: null,
          id: 1,
          name: "test",
        },
        {
          __after__: 1,
          id: 2,
          name: "test2",
        },
        {
          __after__: 2,
          id: 3,
          name: "test3",
        },
        {
          __after__: 3,
          id: 4,
          name: "test4",
        },
      ]);
    }
  });
}
