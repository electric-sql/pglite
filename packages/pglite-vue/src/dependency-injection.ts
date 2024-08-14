import { provide, inject, unref, Ref } from 'vue-demi'
import { PGliteWithLive } from '@electric-sql/pglite/live'

interface PGliteDependencyInjection<T extends PGliteWithLive> {
  providePGlite: (db: Ref<T | undefined> | (T | undefined)) => void
  injectPGlite: () => T | undefined
}

const PGliteKey = Symbol('PGliteProvider')

/**
 * Call this function to get a PGlite provider and injector for your Vue application.
 * We can't provide a predefined provider and injector because that would lose type information
 * as the PGlite interface depends on the extensions provided to PGlite.
 *
 * @example
 * This example loses type information about the PGlite extensions:
 * ```
 * provide<typeof db>(PGliteKey, db)
 *
 * // generic PGlite instance type, no extension types
 * const { db } = inject(PGliteKey)
 * ```
 *
 * @returns An object with two functions: `providePGlite` and `injectPGlite`.
 *
 */
function makePGliteDependencyInjector<
  T extends PGliteWithLive,
>(): PGliteDependencyInjection<T> {
  const providePGlite = (db: Ref<T | undefined> | (T | undefined)): void =>
    provide(PGliteKey, db)

  const injectPGlite = (): T | undefined => {
    const db = inject<Ref<T> | T>(PGliteKey)
    return unref(db)
  }

  return {
    providePGlite,
    injectPGlite,
  }
}

const { injectPGlite, providePGlite } =
  makePGliteDependencyInjector<PGliteWithLive>()

export { makePGliteDependencyInjector, injectPGlite, providePGlite }
