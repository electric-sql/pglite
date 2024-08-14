import { describe, it, expectTypeOf } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { live } from '@electric-sql/pglite/live'
import { vector } from '@electric-sql/pglite/vector'
import { makePGliteProvider } from '../src/provider.js'

describe('provider', () => {
  it('provider type respected ', async () => {
    const dbLiveVector = await PGlite.create({
      extensions: {
        live,
        vector,
      },
    })
    const dbLive = await PGlite.create({
      extensions: {
        live,
      },
    })

    const { PGliteProvider, usePGlite } =
      makePGliteProvider<typeof dbLiveVector>()

    // @ts-expect-error cannot pass db with just live extension
    ;() => <PGliteProvider db={dbLive}></PGliteProvider>
    ;() => <PGliteProvider db={dbLiveVector}></PGliteProvider>

    // @ts-expect-error cannot pass wrong type db to typed hook
    usePGlite(dbLive)

    expectTypeOf(usePGlite()).toEqualTypeOf<typeof dbLiveVector>()
  })
})
