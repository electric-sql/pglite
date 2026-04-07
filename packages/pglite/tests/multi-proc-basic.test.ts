import { describe, it } from 'vitest'
import { testEsmCjsAndDTC } from './test-utils.ts'

it('exec', async () => {
  const { PGlite } = await import('../dist/index.js')
  const db = await PGlite.create({
    singleMode: false,
    debug: 5,
  })
  await db.exec(`
  CREATE TABLE IF NOT EXISTS test (
    id SERIAL PRIMARY KEY,
    name TEXT
  );
`)
})

await testEsmCjsAndDTC(async (importType) => {
  const { PGlite } =
    importType === 'esm'
      ? await import('../dist/index.js')
      : ((await import(
          '../dist/index.cjs'
        )) as unknown as typeof import('../dist/index.js'))

  describe(`basic`, () => {
    it('exec', async () => {
      const db = await PGlite.create({
        debug: 5,
      })
      await db.exec(`
      CREATE TABLE IF NOT EXISTS test (
        id SERIAL PRIMARY KEY,
        name TEXT
      );
    `)
    })
  })
})
