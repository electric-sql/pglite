import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '../pglite/dist/index.js'

const bytesPerRow = Number(process.argv[2] ?? 45056)
const iterations = Number(process.argv[3] ?? 500)
assert(Number.isSafeInteger(bytesPerRow) && bytesPerRow >= 6)
assert(Number.isSafeInteger(iterations) && iterations > 0)
const rowsPerRead = 200
const warmup = 20
const hash = (text) => createHash('sha256').update(text).digest('hex')
const padding = Array.from({ length: Math.ceil(bytesPerRow / 64) }, (_, i) =>
  hash(`generic-text-${i}`),
).join('')
const text = 'é🙂' + padding.slice(0, bytesPerRow - 6)
assert.equal(Buffer.byteLength(text), bytesPerRow)
const directory = await mkdtemp(join(tmpdir(), 'pglite-text-decoding-'))
const db = new PGlite(join(directory, 'db'))
try {
  await db.exec('CREATE TABLE sample (id integer PRIMARY KEY, value text)')
  await db.query(
    'INSERT INTO sample SELECT i, $1 FROM generate_series(1,200) i',
    [text],
  )
  const query = () => db.query('SELECT id,value FROM sample ORDER BY id')
  for (let i = 0; i < warmup; i++) {
    assert.equal((await query()).rows.length, rowsPerRead)
  }
  const cpu = process.cpuUsage()
  const start = process.hrtime.bigint()
  let rows = 0
  let characters = 0
  for (let i = 0; i < iterations; i++) {
    const result = await query()
    rows += result.rows.length
    characters += result.rows[i % rowsPerRead].value.length
  }
  const wallMs = Number(process.hrtime.bigint() - start) / 1e6
  const used = process.cpuUsage(cpu)
  assert.equal(rows, iterations * rowsPerRead)
  assert.equal(characters, iterations * text.length)
  const result = await query()
  assert(result.rows.every((row, i) => row.id === i + 1 && row.value === text))
  const version = (await db.query('SELECT version() AS version')).rows[0]
    .version
  console.log(
    JSON.stringify(
      {
        node: process.version,
        version,
        bytesPerRow,
        rowsPerRead,
        iterations,
        warmup,
        cpuMsPerRead: (used.user + used.system) / 1000 / iterations,
        wallMsPerRead: wallMs / iterations,
      },
      null,
      2,
    ),
  )
} finally {
  await db.close()
  await rm(directory, { recursive: true })
}
