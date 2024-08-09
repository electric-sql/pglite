import test from "ava";
import { PGlite } from "../../dist/index.js";
import { pgcrypto } from "../../dist/contrib/pgcrypto.js";

test("pgcrypto digest", async (t) => {
  const pg = new PGlite({
    extensions: {
      pgcrypto,
    },
  });

  await pg.exec("CREATE EXTENSION IF NOT EXISTS pgcrypto;");

  const res = await pg.query("SELECT encode(digest(convert_to('test', 'UTF8'), 'sha1'), 'hex') as value;");
  t.is(res.rows[0].value, "a94a8fe5ccb19ba61c4c0873d391e987982fbbd3");
});

test("pgcrypto hmac", async (t) => {
  const pg = new PGlite({
    extensions: {
      pgcrypto,
    },
  });

  await pg.exec("CREATE EXTENSION IF NOT EXISTS pgcrypto;");

  const res = await pg.query("SELECT encode(hmac(convert_to('test', 'UTF8'), convert_to('key', 'UTF8'), 'sha1'), 'hex') as value;");
  t.is(res.rows[0].value, "671f54ce0c540f78ffe1e26dcf9c2a047aea4fda");
});

test("pgcrypto crypt", async (t) => {
  const pg = new PGlite({
    extensions: {
      pgcrypto,
    },
  });

  await pg.exec("CREATE EXTENSION IF NOT EXISTS pgcrypto;");

  const res = await pg.query("SELECT crypt('test', gen_salt('bf')) as value;");
  t.is(res.rows[0].value.length, 60);
});

test("pgcrypto gen_salt", async (t) => {
  const pg = new PGlite({
    extensions: {
      pgcrypto,
    },
  });

  await pg.exec("CREATE EXTENSION IF NOT EXISTS pgcrypto;");

  const res = await pg.query("SELECT gen_salt('bf') as value;");
  t.is(res.rows[0].value.length, 29);
});

test("pgcrypto pgp_sym_encrypt and pgp_sym_decrypt", async (t) => {
  const pg = new PGlite({
    extensions: {
      pgcrypto,
    },
  });

  await pg.exec("CREATE EXTENSION IF NOT EXISTS pgcrypto;");

  const res = await pg.query("SELECT pgp_sym_encrypt('test', 'key') as value;");
  const encrypted = res.rows[0].value;

  const res2 = await pg.query("SELECT pgp_sym_decrypt($1, 'key') as value;", [encrypted]);
  t.is(res2.rows[0].value, "test");
});

// TODO: pgp_pub_encrypt and pgp_pub_decrypt
