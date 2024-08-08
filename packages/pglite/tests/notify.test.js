import test from './polytest.js'
import { PGlite } from '../dist/index.js'

test('notify', async (t) => {
  const db = new PGlite()

  await db.listen('test', (payload) => {
    t.is(payload, '321')
  })

  await db.query("NOTIFY test, '321'")

  await new Promise((resolve) => setTimeout(resolve, 1000))
})

test('unlisten', async (t) => {
  const db = new PGlite()

  const unsub = await db.listen('test', () => {
    t.fail()
  })

  await unsub()

  await db.query('NOTIFY test')

  await new Promise((resolve) => setTimeout(resolve, 1000))
  t.pass()
})

test('onNotification', async (t) => {
  const db = new PGlite()

  db.onNotification((chan, payload) => {
    t.is(chan, 'test')
    t.is(payload, '123')
  })

  await db.query('LISTEN test')
  await db.query("NOTIFY test, '123'")

  await new Promise((resolve) => setTimeout(resolve, 1000))
})
