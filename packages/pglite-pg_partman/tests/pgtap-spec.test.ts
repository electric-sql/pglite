import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { pgtap } from '@electric-sql/pglite-pgtap'
import { pg_partman } from '../src/index.js'

const specDir = fileURLToPath(new URL('./pgtap', import.meta.url))
const specFiles = readdirSync(specDir)
  .filter((file) => file.endsWith('.sql'))
  .sort()

// The upstream files are plain SQL apart from psql meta-commands
// (\set ON_ERROR_STOP etc.), which have no meaning outside psql
const stripPsqlMetaCommands = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('\\'))
    .join('\n')

describe('pg_partman upstream pgTAP spec', () => {
  let pg: PGlite
  afterEach(async () => {
    if (pg && !pg.closed) {
      await pg.close()
    }
  })

  it.each(specFiles)('%s', async (file) => {
    pg = await PGlite.create({ extensions: { pg_partman, pgtap } })
    // mirrors the schema layout upstream CI uses to run these files
    await pg.exec(`
      SET TIME ZONE 'UTC';
      CREATE SCHEMA partman;
      CREATE EXTENSION pg_partman SCHEMA partman;
      CREATE EXTENSION pgtap;
    `)

    const sql = stripPsqlMetaCommands(readFileSync(join(specDir, file), 'utf8'))
    const results = await pg.exec(sql)

    // every pgTAP assertion comes back as a result row holding a raw TAP line
    const tapLines = results
      .flatMap((result) => result.rows.map((row) => Object.values(row)[0]))
      .filter((value): value is string => typeof value === 'string')
    const failures = tapLines.filter(
      (line) =>
        line.startsWith('not ok') || line.includes('Looks like you planned'),
    )

    expect(failures).toEqual([])
    expect(
      tapLines.filter((line) => /^ok \d/.test(line)).length,
    ).toBeGreaterThan(0)
  })
})
