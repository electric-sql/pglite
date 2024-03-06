import test from "ava";
import playwright from "playwright";
import { spawn } from "child_process";
import fs from "fs";

const envs = {
  node: ["memory://", "./pgdata-test"],
  chromium: ["memory://", "idb://pgdata-test"],
  firefox: ["memory://", "idb://pgdata-test"],
  webkit: ["memory://", "idb://pgdata-test"],
};

let webserver;
const wsPort = 3334;
const packageDir = new URL("..", import.meta.url).pathname;

test.serial.before(async (t) => {
  webserver = spawn("npx", ["http-server", "--port", wsPort, packageDir], {
    stdio: "ignore",
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
});

test.after.always(async (t) => {
  if (webserver) {
    webserver.kill();
  }
  fs.rmSync("./pgdata-test", { recursive: true });
});

Object.entries(envs).forEach(([env, dbFilenames]) => {
  let browser;

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

  dbFilenames.forEach((dbFilename) => {
    let evaluate;
    let page;

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

    test.serial(`basic ${env} ${dbFilename}`, async (t) => {
      const res = await evaluate(async () => {
        const { PGlite } = await import("../dist/index.js");
        const pg = new PGlite(dbFilename);
        await pg.waitReady;
        await pg.query(`
          CREATE TABLE IF NOT EXISTS test (
            id SERIAL PRIMARY KEY,
            name TEXT
          );
        `);
        await pg.query("INSERT INTO test (name) VALUES ('test');");
        const res = await pg.query(`
          SELECT * FROM test;
        `);
        // await pg.close(); // Currently throws an unhandled promise rejection
        return res;
      });

      t.deepEqual(res, [
        {
          id: 1,
          name: "test",
        },
      ]);
    });

    if (dbFilename === "memory://") {
      // Skip the rest of the tests for memory:// as it's not persisted
      return;
    }

    test.serial(`basic persisted ${env} ${dbFilename}`, async (t) => {
      await page?.reload(); // Refresh the page
      page?.evaluate(`window.dbFilename = "${dbFilename}";`);

      const res = await evaluate(async () => {
        const { PGlite } = await import("../dist/index.js");
        const pg = new PGlite(dbFilename);
        await pg.waitReady;
        const res = await pg.query(`
          SELECT * FROM test;
        `);
        // await pg.close(); // Currently throws an unhandled promise rejection
        return res;
      });

      t.deepEqual(res, [
        {
          id: 1,
          name: "test",
        },
      ]);
    });
  });
});
