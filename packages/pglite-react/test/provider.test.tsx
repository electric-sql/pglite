import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { waitFor } from '@testing-library/dom'
import React from 'react'
import { PGlite } from '@electric-sql/pglite'
import { live, PGliteWithLive } from '@electric-sql/pglite/live'
import { makePGliteProvider, PGliteProvider, usePGlite } from '../src'

describe('provider', () => {
  it('can receive PGlite', async () => {
    const db = await PGlite.create({
      extensions: {
        live,
      },
    })
    const wrapper = ({ children }: { children: React.ReactNode }) => {
      return <PGliteProvider db={db}>{children}</PGliteProvider>
    }

    const { result } = renderHook(() => usePGlite(), { wrapper })

    await waitFor(() => expect(result.current).toBe(db))
  })

  it('can receive PGlite with typed provider', async () => {
    const db = await PGlite.create({
      extensions: {
        live,
      },
    })

    const { PGliteProvider: PGliteProviderTyped, usePGlite: usePGliteTyped } =
      makePGliteProvider<PGliteWithLive>()

    const wrapper = ({ children }: { children: React.ReactNode }) => {
      return <PGliteProviderTyped db={db}>{children}</PGliteProviderTyped>
    }

    const { result } = renderHook(() => usePGliteTyped(), { wrapper })

    await waitFor(() => expect(result.current).toBe(db))
  })
})
