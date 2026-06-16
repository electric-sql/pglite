import { it } from 'vitest'
import { PGlite } from '../../dist/index.js'
import { postgres_fdw } from '../../dist/contrib/postgres_fdw.js'

it('postgres_fdw', async () => {
  const pg = await PGlite.create({
    extensions: {
      postgres_fdw,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS postgres_fdw;')
  await pg.exec(
    `CREATE SERVER myserver FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host '127.0.0.1', dbname 'test', port '7666');`,
  )
  await pg.exec(`CREATE USER MAPPING FOR postgres 
SERVER myserver 
OPTIONS (user 'postgres', password '123456');`)

  await pg.exec(`CREATE SCHEMA schema1;
IMPORT FOREIGN SCHEMA public
FROM SERVER myserver
INTO schema1;
`)

  // const contents = await pg.query(`SELECT * FROM schema1.TestTable`)

  // expect(contents.rows).toEqual([
  //     {
  //     line: 'PGlite is the best!',
  //     },
  // ])
})
