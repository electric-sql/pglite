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
type UsePGliteOptional<T extends PGliteWithLive> = (db?: T) => T | null

interface PGliteProviderSet<T extends PGliteWithLive> {
  PGliteProvider: PGliteProvider<T>
  usePGlite: UsePGlite<T>
  usePGliteOptional: UsePGliteOptional<T>
}

/**
 * Create a typed set of {@link PGliteProvider}, {@link usePGlite}, and
 * {@link usePGliteOptional}.
 */
function makePGliteProvider<T extends PGliteWithLive>(): PGliteProviderSet<T> {
  const ctx = createContext<T | undefined>(undefined)

  // Returns the provided PGlite instance, or null when no PGliteProvider is
  // mounted. Use this when a missing provider is an expected state, e.g. lazy,
  // async, or conditional database loading (see issue #878). An explicit db
  // argument always takes precedence.
  const usePGliteOptional = ((db?: T) => {
    const dbProvided = useContext(ctx)

    // allow providing a db explicitly
    if (db !== undefined) return db

    return dbProvided ?? null
  }) as UsePGliteOptional<T>

  // Returns the provided PGlite instance, throwing if no PGliteProvider is
  // mounted. This fail-fast behavior is the default; reach for
  // usePGliteOptional when the provider may legitimately be absent.
  const usePGlite = ((db?: T) => {
    const dbProvided = usePGliteOptional(db)

    if (!dbProvided)
      throw new Error(
        'No PGlite instance found, use PGliteProvider to provide one',
      )

    return dbProvided
  }) as UsePGlite<T>

  return {
    usePGlite,
    usePGliteOptional,
    PGliteProvider: ({ children, db }: Props<T>) => {
      return <ctx.Provider value={db}>{children}</ctx.Provider>
    },
  }
}

const { PGliteProvider, usePGlite, usePGliteOptional } =
  makePGliteProvider<PGliteWithLive>()

export { makePGliteProvider, PGliteProvider, usePGlite, usePGliteOptional }
