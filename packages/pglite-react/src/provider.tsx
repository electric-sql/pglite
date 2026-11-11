import React, { createContext, useContext } from 'react'
import { PGliteWithLive } from '@electric-sql/pglite/live'

interface Props<T extends PGliteWithLive> {
  children?: React.ReactNode
  db?: T
}

type PGliteProvider<T extends PGliteWithLive> = (
  props: Props<T>,
) => React.JSX.Element
type UsePGlite<T extends PGliteWithLive> = (db?: T) => T

interface PGliteProviderSet<T extends PGliteWithLive> {
  PGliteProvider: PGliteProvider<T>
  usePGlite: UsePGlite<T>
}

const defaultContext = createContext<PGliteWithLive | undefined>(undefined)

function makePGliteProviderSet<T extends PGliteWithLive>(
  ctx: React.Context<T | undefined>,
  bridgeDefaultContext: boolean,
): PGliteProviderSet<T> {
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
    PGliteProvider: ({ children, db }: Props<T>) => {
      const provider = <ctx.Provider value={db}>{children}</ctx.Provider>

      return bridgeDefaultContext ? (
        <defaultContext.Provider value={db}>{provider}</defaultContext.Provider>
      ) : (
        provider
      )
    },
  }
}

/**
 * Create a typed set of {@link PGliteProvider} and {@link usePGlite}.
 */
function makePGliteProvider<T extends PGliteWithLive>(): PGliteProviderSet<T> {
  const ctx = createContext<T | undefined>(undefined)
  return makePGliteProviderSet(ctx, true)
}

const { PGliteProvider, usePGlite } = makePGliteProviderSet(
  defaultContext,
  false,
)

export { makePGliteProvider, PGliteProvider, usePGlite }
