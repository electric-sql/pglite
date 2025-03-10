import { describe, it, expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { pgDump } from '../dist/pg_dump.js'

describe('pgDump', () => {
  it('should dump an empty database', async () => {
    const pg = await PGlite.create()
    const dump = await pgDump({ pg })

    expect(dump).toBeInstanceOf(File)
    expect(dump.name).toBe('dump.sql')

    const content = await dump.text()
    expect(content).toContain('PostgreSQL database dump')
  })

  it('should dump a database with tables and data', async () => {
    const pg = await PGlite.create()

    // Create test tables and insert data
    await pg.exec(`
      CREATE TABLE test1 (
        id SERIAL PRIMARY KEY,
        name TEXT
      );
      INSERT INTO test1 (name) VALUES ('test1-row1');
      
      CREATE TABLE test2 (
        id SERIAL PRIMARY KEY,
        value INTEGER
      );
      INSERT INTO test2 (value) VALUES (42);
    `)

    const dump = await pgDump({ pg })
    const content = await dump.text()

    // Check for table creation
    expect(content).toContain('CREATE TABLE public.test1')
    expect(content).toContain('CREATE TABLE public.test2')

    // Check for data inserts
    expect(content).toContain('INSERT INTO public.test1')
    expect(content).toContain("'test1-row1'")
    expect(content).toContain('INSERT INTO public.test2')
    expect(content).toContain('42')
  })

  it('should respect custom filename', async () => {
    const pg = await PGlite.create()
    const dump = await pgDump({ pg, fileName: 'custom.sql' })

    expect(dump.name).toBe('custom.sql')
  })

  it('should handle custom pg_dump arguments', async () => {
    const pg = await PGlite.create()
    await pg.exec(`
      CREATE TABLE test (id SERIAL PRIMARY KEY, name TEXT);
      INSERT INTO test (name) VALUES ('row1');
    `)

    // Use --schema-only to exclude data
    const dump = await pgDump({ pg, args: ['--schema-only'] })
    const content = await dump.text()

    expect(content).toContain('CREATE TABLE public.test')
    expect(content).not.toContain('INSERT INTO public.test')
  })

  it('should be able to restore dumped database', async () => {
    const pg1 = await PGlite.create()

    // Create original database
    await pg1.exec(`
      CREATE TABLE test (id SERIAL PRIMARY KEY, name TEXT);
      INSERT INTO test (name) VALUES ('row1'), ('row2');
    `)

    // Dump database
    const dump = await pgDump({ pg: pg1 })
    const dumpContent = await dump.text()

    // Create new database and restore
    const pg2 = await PGlite.create()
    await pg2.exec(dumpContent)

    // Verify data
    const result = await pg2.query<{ name: string }>(
      'SELECT * FROM public.test ORDER BY id',
    )
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0].name).toBe('row1')
    expect(result.rows[1].name).toBe('row2')
  })
})
