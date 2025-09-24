import { describe, it, expect } from 'vitest'
import { PGlite } from '../../dist/index.js'
import { pgcrypto } from '../../dist/contrib/pgcrypto.js'

describe('pg_pgcryptotrgm', () => {
  it('digest', async () => {
    const pg = new PGlite({
      extensions: {
        pgcrypto,
      },
    })

    await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;')

    const res = await pg.query(
      "SELECT encode(digest(convert_to('test', 'UTF8'), 'sha1'), 'hex') as value;",
    )
    expect(res.rows[0].value, 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3')
  })

  it('hmac', async () => {
    const pg = new PGlite({
      extensions: {
        pgcrypto,
      },
    })

    await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;')

    const res = await pg.query(
      "SELECT encode(hmac(convert_to('test', 'UTF8'), convert_to('key', 'UTF8'), 'sha1'), 'hex') as value;",
    )
    expect(res.rows[0].value).toEqual(
      '671f54ce0c540f78ffe1e26dcf9c2a047aea4fda',
    )
  })

  it('crypt', async () => {
    const pg = new PGlite({
      extensions: {
        pgcrypto,
      },
    })

    await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;')

    const res = await pg.query("SELECT crypt('test', gen_salt('bf')) as value;")
    expect(res.rows[0].value.length).toEqual(60)
  })

  it('gen_salt', async () => {
    const pg = new PGlite({
      extensions: {
        pgcrypto,
      },
    })

    await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;')

    const res = await pg.query("SELECT gen_salt('bf') as value;")
    expect(res.rows[0].value.length).toEqual(29)
  })

  it('pgp_sym_encrypt and pgp_sym_decrypt', async () => {
    const pg = new PGlite({
      extensions: {
        pgcrypto,
      },
    })

    await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;')

    const res = await pg.query(
      "SELECT pgp_sym_encrypt('test', 'key') as value;",
    )
    const encrypted = res.rows[0].value

    const res2 = await pg.query("SELECT pgp_sym_decrypt($1, 'key') as value;", [
      encrypted,
    ])
    expect(res2.rows[0].value).toEqual('test')
  })
})

// TODO: pgp_pub_encrypt and pgp_pub_decrypt
