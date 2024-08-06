import test from "ava";
import * as fs from "fs/promises";
import { PGlite } from "../dist/index.js";

test.serial("user switching", async (t) => {
  await fs.rm("./pgdata-test-user", { force: true, recursive: true });

  const db = new PGlite("./pgdata-test-user");
  await db.exec(
    "CREATE USER test_user WITH PASSWORD 'md5abdbecd56d5fbd2cdaee3d0fa9e4f434';"
  );

  await db.exec(`
    CREATE TABLE test (
      id SERIAL PRIMARY KEY,
      number INT
    );
    INSERT INTO test (number) VALUES (42);
  `);

  await db.exec(`
    CREATE TABLE test2 (
      id SERIAL PRIMARY KEY,
      number INT
    );
    INSERT INTO test2 (number) VALUES (42);
  `);

  await db.exec("ALTER TABLE test2 OWNER TO test_user;");

  await db.close();

  const db2 = new PGlite({
    dataDir: "./pgdata-test-user",
    username: "test_user",
  });

  const currentUsername = await db2.query("SELECT current_user;");
  t.deepEqual(currentUsername.rows, [{ current_user: "test_user" }]);

  await t.throwsAsync(() => db2.query("SELECT * FROM test;"), {
    message: "permission denied for table test",
  });

  const test2 = await db2.query("SELECT * FROM test2;");
  t.deepEqual(test2.rows, [{ id: 1, number: 42 }]);

  await t.throwsAsync(() => db2.query("SET ROLE postgres;"), {
    message: `permission denied to set role "postgres"`,
  });
});

test.serial("switch to user created after initial run", async (t) => {
  await fs.rm("./pgdata-test-user", { force: true, recursive: true });

  const db0 = new PGlite("./pgdata-test-user");
  await db0.waitReady;
  await db0.close();

  const db = new PGlite("./pgdata-test-user");
  await db.exec(
    "CREATE USER test_user WITH PASSWORD 'md5abdbecd56d5fbd2cdaee3d0fa9e4f434';"
  );

  await db.exec(`
    CREATE TABLE test (
      id SERIAL PRIMARY KEY,
      number INT
    );
    INSERT INTO test (number) VALUES (42);
  `);

  await db.exec(`
    CREATE TABLE test2 (
      id SERIAL PRIMARY KEY,
      number INT
    );
    INSERT INTO test2 (number) VALUES (42);
  `);

  await db.exec("ALTER TABLE test2 OWNER TO test_user;");

  await db.close();

  const db2 = new PGlite({
    dataDir: "./pgdata-test-user",
    username: "test_user",
  });

  const currentUsername = await db2.query("SELECT current_user;");
  t.deepEqual(currentUsername.rows, [{ current_user: "test_user" }]);

  await t.throwsAsync(() => db2.query("SELECT * FROM test;"), {
    message: "permission denied for table test",
  });

  const test2 = await db2.query("SELECT * FROM test2;");
  t.deepEqual(test2.rows, [{ id: 1, number: 42 }]);

  await t.throwsAsync(() => db2.query("SET ROLE postgres;"), {
    message: `permission denied to set role "postgres"`,
  });
});
