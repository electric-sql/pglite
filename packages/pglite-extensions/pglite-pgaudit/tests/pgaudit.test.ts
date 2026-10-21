import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { pgaudit } from '../src/index.js'

describe(`pgaudit`, () => {
  let pg: PGlite
  let dataDirArchive: File | Blob
  let stderr: string = ''
  const onStderr = (text: string) => {
    stderr += text
    return true
  }

  beforeEach(async () => {
    stderr = ''
    if (!dataDirArchive) {
      pg = await PGlite.create({
        debug: 1,
        extensions: { pgaudit },
        onStderr,
      })
      dataDirArchive = await pg.dumpDataDir('gzip')
    } else {
      pg = await PGlite.create({
        debug: 1,
        extensions: { pgaudit },
        loadDataDir: dataDirArchive,
        onStderr,
      })
    }
    await pg.exec('CREATE EXTENSION IF NOT EXISTS pgaudit;')
  })
  afterEach(async () => {
    if (!pg.closed) {
      await pg.close()
    }
  })

  it('can load extension', async () => {
    // Verify the extension is loaded
    const res = await pg.query<{ extname: string }>(`
        SELECT extname 
        FROM pg_extension 
        WHERE extname = 'pgaudit'
      `)

    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].extname).toBe('pgaudit')
  })

  it('should do audit log', async () => {
    const _res = await pg.exec(`
        set pgaudit.log = 'read, ddl';
        set pgaudit.log_level = notice;
        create table account
        (
            id int,
            name text,
            password text,
            description text
        );

        insert into account (id, name, password, description)
                    values (1, 'user1', 'HASH1', 'blah, blah');

        select *
            from account;
              `)
    expect(stderr).contain('AUDIT', 'Did not receive expected audit output')
  })
})
