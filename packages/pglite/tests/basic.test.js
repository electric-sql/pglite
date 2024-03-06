import test from "ava";
import playwright from "playwright";
import { spawn } from "child_process";

const envs = ['node', 'chromium', 'firefox', 'webkit'];

let webserver;
const wsPort = 3334;
const packageDir = new URL("..", import.meta.url).pathname;

test.serial.before(async (t) => {
  webserver = spawn("npx", ["http-server", '--port', wsPort, packageDir], {
    stdio: "ignore",
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
});

test.after.always(async (t) => {
  if (webserver) {
    webserver.kill();
  }
});

envs.forEach((env) => {
  let evaluate;
  let browser;

  test.serial.before(async (t) => {
    if (env === "node") {
      evaluate = async (fn) => fn();
    } else {
      browser = await playwright[env].launch();
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`http://localhost:${wsPort}/tests/blank.html`);
      evaluate = async (fn) => await page.evaluate(fn);
    }
  });

  test.after(async (t) => {
    if (browser) {
      await browser.close();
    }
  });

  test.serial(`${env} basic`, async (t) => {
    const res = await evaluate(async () => {
      const { PGlite } = await import("../dist/index.js");
      const pg = new PGlite();
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
});
