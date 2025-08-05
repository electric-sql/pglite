import { PGliteWithLive } from '@electric-sql/pglite/live'
import { createContext, ParentProps, useContext } from 'solid-js'
import { JSX } from 'solid-js/jsx-runtime'

interface Props<T extends PGliteWithLive> extends ParentProps<{ db?: T }> {}

type PGliteProvider<T extends PGliteWithLive> = (props: Props<T>) => JSX.Element
type UsePGlite<T extends PGliteWithLive> = (db?: T) => T

interface PGliteProviderSet<T extends PGliteWithLive> {
  PGliteProvider: PGliteProvider<T>
  usePGlite: UsePGlite<T>
}

/**
 * Create a typed set of {@link PGliteProvider} and {@link usePGlite}.
 */
function makePGliteProvider<T extends PGliteWithLive>(): PGliteProviderSet<T> {
  const ctx = createContext<T | undefined>(undefined)
  return {
    usePGlite: ((db?: T) => {
      const dbProvided = useContext(ctx)

      // allow providing a db explicitly
      if (db !== undefined) return db

      if (!dbProvided)
        throw new Error(
          'No PGlite instance found, use PGliteProvider to provide one',
        )

      return dbProvided
    }) as UsePGlite<T>,
    PGliteProvider: (props: Props<T>) => {
      return <ctx.Provider value={props.db}>{props.children}</ctx.Provider>
    },
  }
}

const { PGliteProvider, usePGlite } = makePGliteProvider<PGliteWithLive>()

export { makePGliteProvider, PGliteProvider, usePGlite }
