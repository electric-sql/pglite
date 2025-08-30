/**
 * Jest smoke test harness for environments that can run RN code.
 * Note: This will not run in a plain Node environment.
 */
import { smokeTest } from './scripts/smoke-test'

describe('PGlite RN smoke', () => {
  it('select 1', async () => {
    const msg = await smokeTest()
    expect(typeof msg).toBe('string')
  })
})

