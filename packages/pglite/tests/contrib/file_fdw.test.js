import { it, expect } from 'vitest'
import { PGlite } from '../../dist/index.js'
import { file_fdw } from '../../dist/contrib/file_fdw.js'

it('file_fdw', async () => {
  const pg = await PGlite.create({
    extensions: {
      file_fdw,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS file_fdw;')
  await pg.exec('CREATE SERVER file_server FOREIGN DATA WRAPPER file_fdw;')
  await pg.exec(`CREATE FOREIGN TABLE file_contents (line text)
    SERVER file_server
    OPTIONS (
        filename '/tmp/pglite/bin/postgres',
        format 'text'
    );`)

  const contents = await pg.query(`SELECT * FROM file_contents;`)
  expect(contents.rows).toEqual([
    {
      line: 'PGlite is the best!',
    },
  ])
})
