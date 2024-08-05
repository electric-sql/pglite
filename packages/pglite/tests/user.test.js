import test from "ava";
import * as fs from "fs/promises";
import { PGlite } from "../dist/index.js";

test("user switching", async (t) => {
  await fs.rm("./pgdata-test-user", { force: true, recursive: true });

  const db = new PGlite('./pgdata-test-user');
  await db.exec("CREATE USER test_user WITH PASSWORD 'test_password';");
  await db.exec(`
    CREATE TABLE test (
      id SERIAL PRIMARY KEY,
      number INT
    );
    INSERT INTO test (number) VALUES (42);
  `);
  await db.close();

  const db2 = new PGlite({
    dataDir: './pgdata-test-user',
    username: "test_user",
  });

  const test_user = await db2.query("SET ROLE test_user");

  const result = await db2.query("SELECT * FROM test;");
  t.deepEqual(result.rows, [{ id: 1, number: 42 }]);

  const currentUsername = await db2.query("SELECT current_user;");
  t.deepEqual(currentUsername.rows, [{ current_user: "test_user" }]);
});
