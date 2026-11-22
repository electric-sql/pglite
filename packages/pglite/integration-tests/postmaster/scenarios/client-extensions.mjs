import assert from 'node:assert/strict'
import { PGlitePostmaster } from '@electric-sql/pglite/postmaster'
import { live } from '@electric-sql/pglite/live'

const [wasm, glue, data] = process.argv.slice(2)
const options = wasm ? { artifact: { wasm, glue, data } } : {}
const closed = []
const initialized = []
const client = {
  name: 'session-probe',
  dependsOn: [live.name],
  async setup(session, _, clientOnly) {
    assert.equal(clientOnly, true)
    assert.equal(typeof session.live.query, 'function')
    return {
      init: async () => initialized.push(session),
      close: async () => closed.push(session),
    }
  },
}
const pm = await PGlitePostmaster.create({
  ...options,
  extensions: { client, live },
})
let timeout
try {
  const [a, b] = await Promise.all([pm.createSession(), pm.createSession()])
  assert.equal(initialized.length, 2)
  assert.notEqual(a.live, b.live)
  await a.exec('CREATE TABLE watched (n int); INSERT INTO watched VALUES (1)')
  let notify
  const updated = new Promise((resolve) => {
    notify = resolve
  })
  const [sub, second] = await Promise.all([
    a.live.query('SELECT n FROM watched', [], ({ rows }) => {
      if (rows[0].n === 2) notify()
    }),
    b.live.query('SELECT n FROM watched'),
  ])
  assert.deepEqual(sub.initialResults.rows, [{ n: 1 }])
  assert.deepEqual(second.initialResults.rows, [{ n: 1 }])
  await second.unsubscribe()
  await b.exec('UPDATE watched SET n = 2')
  await Promise.race([
    updated,
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(Error('Timed out waiting for live query')),
        5000,
      )
    }),
  ])
  await sub.unsubscribe()
  await a.close()
  assert.deepEqual(closed, [a])
  assert.deepEqual((await b.query('SELECT n FROM watched')).rows, [{ n: 2 }])
  await b.close()
  assert.deepEqual(closed, [a, b])
} finally {
  clearTimeout(timeout)
  await pm.close()
}
const fresh = await PGlitePostmaster.create(wasm ? options : undefined)
try {
  const session = await fresh.createSession()
  assert.deepEqual(
    (await session.query("SELECT to_regclass('watched') AS name")).rows,
    [{ name: null }],
  )
  await session.close()
} finally {
  await fresh.close()
}

let attempts = 0
let cleanups = 0
const legacy = {
  name: 'legacy',
  async setup() {
    return {
      bundlePath:
        ++attempts === 1 ? new URL('file:///legacy.tar.gz') : undefined,
      close: async () => {
        cleanups++
      },
    }
  },
}
const retry = await PGlitePostmaster.create({
  ...options,
  dataDir: 'memory://',
  extensions: { legacy },
})
try {
  await assert.rejects(retry.createSession(), /requires backend configuration/)
  assert.equal(cleanups, 1)
  const session = await retry.createSession()
  assert.deepEqual((await session.query('SELECT 1 AS n')).rows, [{ n: 1 }])
  await session.close()
  assert.equal(cleanups, 2)
} finally {
  await retry.close()
}
