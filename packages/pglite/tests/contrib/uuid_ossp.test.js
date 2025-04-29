import { describe, it, expect } from 'vitest'
import { PGlite } from '../../dist/index.js'
import { uuid_ossp } from '../../dist/contrib/uuid_ossp.js'

describe('uuid_ossp', () => {
  it('uuid_generate_v1', async () => {
    const pg = new PGlite({
      "debug":true,
      extensions: {
        uuid_ossp,
      },
    })

    await pg.exec('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')

    const res = await pg.query('SELECT uuid_generate_v1() as value;')

    expect(res.rows[0].value.length).toBe(36)
  })

  it('uuid_generate_v3', async () => {
    const pg = new PGlite({
      extensions: {
        uuid_ossp,
      },
    })

    await pg.exec('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')

    const res = await pg.query(
      "SELECT uuid_generate_v3(uuid_ns_dns(), 'www.example.com') as value;",
    )

    expect(res.rows[0].value.length).toBe(36)
  })

  it('uuid_generate_v4', async () => {
    const pg = new PGlite({
      extensions: {
        uuid_ossp,
      },
    })

    await pg.exec('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')

    const res = await pg.query('SELECT uuid_generate_v4() as value;')

    expect(res.rows[0].value.length).toBe(36)
  })

  it('uuid_generate_v5', async () => {
    const pg = new PGlite({
      extensions: {
        uuid_ossp,
      },
    })

    await pg.exec('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')

    const res = await pg.query(
      "SELECT uuid_generate_v5(uuid_ns_dns(), 'www.example.com') as value;",
    )

    expect(res.rows[0].value.length).toBe(36)
  })

  it('uuid_nil', async () => {
    const pg = new PGlite({
      extensions: {
        uuid_ossp,
      },
    })

    await pg.exec('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')

    const res = await pg.query('SELECT uuid_nil() as value;')

    expect(res.rows[0].value).toBe('00000000-0000-0000-0000-000000000000')
  })

  it('uuid_ns_dns', async () => {
    const pg = new PGlite({
      extensions: {
        uuid_ossp,
      },
    })

    await pg.exec('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')

    const res = await pg.query('SELECT uuid_ns_dns() as value;')

    expect(res.rows[0].value).toBe('6ba7b810-9dad-11d1-80b4-00c04fd430c8')
  })

  it('uuid_ns_oid', async () => {
    const pg = new PGlite({
      extensions: {
        uuid_ossp,
      },
    })

    await pg.exec('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')

    const res = await pg.query('SELECT uuid_ns_oid() as value;')

    expect(res.rows[0].value).toBe('6ba7b812-9dad-11d1-80b4-00c04fd430c8')
  })
})
