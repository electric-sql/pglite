/**
 * @vitest-environment node
 */
import { describe, it, expectTypeOf } from 'vitest'
import { PGlite, PGliteInterfaceExtensions } from '@electric-sql/pglite'
import { live } from '@electric-sql/pglite/live'
import { makePGliteDependencyInjector } from '../src'
import { vector } from '@electric-sql/pglite/vector'

describe('dependency injection', () => {
  it('typechecks instance being provided and injected', async () => {
    const dbLive = await PGlite.create({
      extensions: {
        live,
      },
    })

    const dbLiveVector = await PGlite.create({
      extensions: {
        live,
        vector,
      },
    })
    const { providePGlite, injectPGlite } = makePGliteDependencyInjector<
      PGlite &
        PGliteInterfaceExtensions<{
          live: typeof live
          vector: typeof vector
        }>
    >()

    // @ts-expect-error name is a string
    providePGlite(dbLive)

    providePGlite(dbLiveVector)

    expectTypeOf(injectPGlite()!).toEqualTypeOf<typeof dbLiveVector>()
  })
})
