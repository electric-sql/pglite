import { describe, it, expect } from 'vitest'
import { PGlite } from '../../dist/index.js'
import { pgcrypto } from '../../dist/contrib/pgcrypto.js'
import * as openpgp from 'openpgp'

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

  it('armor', async () => {
    const pg = new PGlite({
      extensions: {
        pgcrypto,
      },
    })

    await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;')

    const res = await pg.query("SELECT armor(digest('test', 'sha1')) as value;")
    expect(res.rows[0].value).toContain('-----BEGIN PGP MESSAGE-----')
    expect(res.rows[0].value).toContain('-----END PGP MESSAGE-----')
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

  it('pgp_pub_encrypt and pgp_pub_decrypt', async () => {
    const pg = new PGlite({
      extensions: {
        pgcrypto,
      },
    })

    await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;')

    const { privateKey, publicKey } = await openpgp.generateKey({
      type: 'rsa',
      rsaBits: 2048,
      userIDs: [{ name: 'PGlite', email: 'hello@pglite.dev' }],
      passphrase: '',
    })

    const toEncrypt = 'PGlite@$#%!^$&*WQFgjqPkVERewfreg094340f1012-='

    const e2 = await pg.exec(
      `
WITH encrypted AS (
    SELECT pgp_pub_encrypt('${toEncrypt}', dearmor('${publicKey}')) AS encrypted
)
SELECT
    pgp_pub_decrypt(encrypted, dearmor('${privateKey}')) as decrypted_output
FROM encrypted;
`,
    )
    expect(e2[0].rows[0].decrypted_output, toEncrypt)
  })

  it('pgp_key_id', async () => {
    const pg = new PGlite({
      extensions: {
        pgcrypto,
      },
    })

    await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;')

    const { publicKey } = await openpgp.generateKey({
      type: 'rsa',
      rsaBits: 2048,
      userIDs: [{ name: 'PGlite', email: 'hello@pglite.dev' }],
      passphrase: '',
    })

    const res = await pg.query(
      `SELECT pgp_key_id(dearmor('${publicKey}')) as value;`,
    )
    // pgp_key_id returns a 16-character hex string
    expect(res.rows[0].value).toHaveLength(16)
    expect(res.rows[0].value).toMatch(/^[0-9A-F]+$/)
  })

  it('pgp_armor_headers', async () => {
    const pg = new PGlite({
      extensions: {
        pgcrypto,
      },
    })

    await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;')

    // Create armored data with headers
    const res = await pg.query(
      `SELECT armor(digest('test', 'sha1'), ARRAY['key1'], ARRAY['value1']) as armored;`,
    )
    const armored = res.rows[0].armored

    const res2 = await pg.query(`SELECT * FROM pgp_armor_headers($1);`, [
      armored,
    ])
    expect(res2.rows).toContainEqual({ key: 'key1', value: 'value1' })
  })

  it('encrypt and decrypt', async () => {
    const pg = new PGlite({
      extensions: {
        pgcrypto,
      },
    })

    await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;')

    const res = await pg.query(
      `SELECT encrypt('test data'::bytea, 'secret key'::bytea, 'aes') as encrypted;`,
    )
    const encrypted = res.rows[0].encrypted

    const res2 = await pg.query(
      `SELECT convert_from(decrypt($1, 'secret key'::bytea, 'aes'), 'UTF8') as decrypted;`,
      [encrypted],
    )
    expect(res2.rows[0].decrypted).toEqual('test data')
  })

  it('encrypt_iv and decrypt_iv', async () => {
    const pg = new PGlite({
      extensions: {
        pgcrypto,
      },
    })

    await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;')

    // AES block size is 16 bytes, so IV must be 16 bytes
    const iv = '1234567890123456'

    const res = await pg.query(
      `SELECT encrypt_iv('test data'::bytea, 'secret key'::bytea, '${iv}'::bytea, 'aes') as encrypted;`,
    )
    const encrypted = res.rows[0].encrypted

    const res2 = await pg.query(
      `SELECT convert_from(decrypt_iv($1, 'secret key'::bytea, '${iv}'::bytea, 'aes'), 'UTF8') as decrypted;`,
      [encrypted],
    )
    expect(res2.rows[0].decrypted).toEqual('test data')
  })

  it('gen_random_bytes', async () => {
    const pg = new PGlite({
      extensions: {
        pgcrypto,
      },
    })

    await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;')

    const res = await pg.query(
      `SELECT length(gen_random_bytes(32)) as len, encode(gen_random_bytes(16), 'hex') as bytes;`,
    )
    expect(res.rows[0].len).toEqual(32)
    // 16 bytes = 32 hex characters
    expect(res.rows[0].bytes).toHaveLength(32)
  })

  it('gen_random_uuid', async () => {
    const pg = new PGlite({
      extensions: {
        pgcrypto,
      },
    })

    await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;')

    const res = await pg.query(`SELECT gen_random_uuid() as uuid;`)
    // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    expect(res.rows[0].uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  })
})
