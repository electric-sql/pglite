import test from "ava";
import { PGlite } from "../../dist/index.js";
import { adminpack } from "../../dist/contrib/adminpack.js";

test("adminpack", async (t) => {
  const pg = new PGlite({
    extensions: {
      adminpack,
    },
  });

  await pg.exec("CREATE EXTENSION IF NOT EXISTS adminpack;");

  // Write a file to the virtual file system
  const res = await pg.query("SELECT pg_catalog.pg_file_write('/test.txt', 'test', false);");
  t.deepEqual(res.rows, [
    {
      "pg_file_write": 4
    }
  ]);

  // Read the file from the virtual file system to verify the content
  const stream = pg.Module.FS.open("/test.txt", "r");
  const buffer = new Uint8Array(4);
  pg.Module.FS.read(stream, buffer, 0, 4, 0);
  pg.Module.FS.close(stream);
  const text = new TextDecoder().decode(buffer);
  t.is(text, "test");

  // Rename the file
  const res2 = await pg.query("SELECT pg_catalog.pg_file_rename('/test.txt', '/test2.txt');");
  t.deepEqual(res2.rows, [
    {
      "pg_file_rename": true
    }
  ]);
  const stats = pg.Module.FS.lstat("/test2.txt");
  t.is(stats.size, 4);

  // Remove the file
  const res3 = await pg.query("SELECT pg_catalog.pg_file_unlink('/test2.txt');");
  t.deepEqual(res3.rows, [
    {
      "pg_file_unlink": true
    }
  ]);
  // should throw an error
  try {
    pg.Module.FS.lstat("/test2.txt")
  } catch (e) {
    t.is(e.errno, 44);
  }
});
