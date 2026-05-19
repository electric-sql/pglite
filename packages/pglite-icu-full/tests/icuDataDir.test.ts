import { describe, it, expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import * as fs from 'fs/promises'
import { resolve } from 'path'

describe('full icu tests', () => {
  it('load icu', async () => {
    const pg_defIcu = await PGlite.create()

    const defLocales = await pg_defIcu.exec(`
SELECT n.nspname AS schema, c.collname AS name, c.collcollate AS locale,
  c.collctype AS ctype, c.collprovider AS provider, c.collversion
FROM pg_collation c
JOIN pg_namespace n ON c.collnamespace = n.oid
ORDER BY schema, name;
`)

    expect(defLocales[0].rows.length).toBeGreaterThanOrEqual(10)

    const icuDataDir = await fs.readFile(
      resolve(import.meta.dirname, '../dist/icu.76.tgz'),
    )
    const pg_fullIcu = await PGlite.create({
      icuDataDir: new Blob([new Uint8Array(icuDataDir)]),
    })

    const allLocales = await pg_fullIcu.exec(`
SELECT n.nspname AS schema, c.collname AS name, c.collcollate AS locale,
  c.collctype AS ctype, c.collprovider AS provider, c.collversion
FROM pg_collation c
JOIN pg_namespace n ON c.collnamespace = n.oid
ORDER BY schema, name;
        `)

    expect(allLocales[0].rows.length).toBeGreaterThanOrEqual(879)
    expect(defLocales[0].rows.length).toBeLessThan(allLocales[0].rows.length)
  })
})
