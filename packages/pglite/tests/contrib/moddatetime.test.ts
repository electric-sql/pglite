import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '../../dist/index.js'
import { moddatetime } from '../../dist/contrib/moddatetime.js'

describe('moddatetime', () => {
  let pg: PGlite
  let dataDirArchive: File | Blob
  beforeEach(async () => {
    if (!dataDirArchive) {
      pg = await PGlite.create({
        extensions: { moddatetime },
      })
      dataDirArchive = await pg.dumpDataDir('gzip')
    } else {
      pg = await PGlite.create({
        extensions: { moddatetime },
        loadDataDir: dataDirArchive,
      })
    }
    await pg.exec('CREATE EXTENSION IF NOT EXISTS "moddatetime";')
  })
  afterEach(async () => {
    if (!pg.closed) {
      await pg.close()
    }
  })

  it('moddatetime', async () => {
    await pg.exec(`
      CREATE OR REPLACE FUNCTION manage_updated_at(_tbl regclass) RETURNS VOID AS $$
      BEGIN
          EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON %s
                          FOR EACH ROW EXECUTE PROCEDURE moddatetime("updatedAt")', _tbl);
      END;
      $$ LANGUAGE plpgsql;
    `)

    await pg.exec(`
      CREATE TABLE "users" (
        "id" SERIAL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );

      SELECT manage_updated_at('users');
    `)

    await pg.exec(`INSERT INTO "users" ("name") VALUES ('test');`)
    const res = await pg.query(`SELECT * FROM "users"`)
    expect(res.rows[0].updatedAt.getTime()).toBe(
      res.rows[0].createdAt.getTime(),
    )

    await pg.exec(`UPDATE "users" SET "name" = 'test2' WHERE "name" = 'test';`)
    const res2 = await pg.query(`SELECT * FROM "users"`)
    expect(res2.rows[0].updatedAt.getTime()).toBeGreaterThan(
      res2.rows[0].createdAt.getTime(),
    )
  })
})
