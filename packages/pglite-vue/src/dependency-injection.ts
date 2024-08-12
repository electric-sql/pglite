import { provide, inject, unref, Ref } from 'vue-demi'
import { PGliteWithLive } from '@electric-sql/pglite/live'

interface PGliteDependencyInjection<T extends PGliteWithLive> {
  providePGlite: (db: Ref<T | undefined> | (T | undefined)) => void
  injectPGlite: () => T | undefined
}

const PGliteKey = Symbol('PGliteProvider')

/**
 * Call this function to get aa PGlite provider and injector for your Vue application.
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
export function makePGliteDependencyInjector<
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

/**
 * This "static" injector is used internally by our reactive methods
 * to get access to the provided PGlite instance.
 * It loses information about the extensions present on PGlite,
 * but we only need the `live` extension information for our methods.
 * However, users preferably don't lose extension type information,
 * therefore, they can use {@link makePGliteDependencyInjector}.
 */
const { injectPGlite: injectPGliteUntyped } = makePGliteDependencyInjector()

export { injectPGliteUntyped }
