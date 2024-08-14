import React, { createContext, useContext } from 'react'
import { PGliteWithLive } from '@electric-sql/pglite/live'

interface Props<T extends PGliteWithLive> {
  children?: React.ReactNode
  db?: T
}

type PGliteProvider<T extends PGliteWithLive> = (props: Props<T>) => JSX.Element
type UsePGlite<T extends PGliteWithLive> = () => T

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
    usePGlite: (db?: T) => {
      const dbProvided = useContext(ctx)

      // allow providing a db explicitly
      if (db) return db

      if (!dbProvided)
        throw new Error(
          'No PGlite instance found, use PGliteProvider to provide one',
        )

      return dbProvided
    },
    PGliteProvider: ({ children, db }: Props<T>) => {
      return <PGliteProvider db={db}>{children}</PGliteProvider>
    },
  }
}

const { PGliteProvider, usePGlite } = makePGliteProvider<PGliteWithLive>()

export { makePGliteProvider, PGliteProvider, usePGlite }
