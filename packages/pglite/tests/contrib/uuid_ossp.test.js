import test from 'ava'
import { PGlite } from '../../dist/index.js'
import { uuid_ossp } from '../../dist/contrib/uuid_ossp.js'

test('uuid_ossp uuid_generate_v1', async (t) => {
  const pg = new PGlite({
    extensions: {
      uuid_ossp,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')

  const res = await pg.query('SELECT uuid_generate_v1() as value;')

  t.is(res.rows[0].value.length, 36)
})

test('uuid_ossp uuid_generate_v3', async (t) => {
  const pg = new PGlite({
    extensions: {
      uuid_ossp,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')

  const res = await pg.query(
    "SELECT uuid_generate_v3(uuid_ns_dns(), 'www.example.com') as value;",
  )

  t.is(res.rows[0].value.length, 36)
})

test('uuid_ossp uuid_generate_v4', async (t) => {
  const pg = new PGlite({
    extensions: {
      uuid_ossp,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')

  const res = await pg.query('SELECT uuid_generate_v4() as value;')

  t.is(res.rows[0].value.length, 36)
})

test('uuid_ossp uuid_generate_v5', async (t) => {
  const pg = new PGlite({
    extensions: {
      uuid_ossp,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')

  const res = await pg.query(
    "SELECT uuid_generate_v5(uuid_ns_dns(), 'www.example.com') as value;",
  )

  t.is(res.rows[0].value.length, 36)
})

test('uuid_ossp uuid_nil', async (t) => {
  const pg = new PGlite({
    extensions: {
      uuid_ossp,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')

  const res = await pg.query('SELECT uuid_nil() as value;')

  t.is(res.rows[0].value, '00000000-0000-0000-0000-000000000000')
})

test('uuid_ossp uuid_ns_dns', async (t) => {
  const pg = new PGlite({
    extensions: {
      uuid_ossp,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')

  const res = await pg.query('SELECT uuid_ns_dns() as value;')

  t.is(res.rows[0].value, '6ba7b810-9dad-11d1-80b4-00c04fd430c8')
})

test('uuid_ossp uuid_ns_oid', async (t) => {
  const pg = new PGlite({
    extensions: {
      uuid_ossp,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')

  const res = await pg.query('SELECT uuid_ns_oid() as value;')

  t.is(res.rows[0].value, '6ba7b812-9dad-11d1-80b4-00c04fd430c8')
})
