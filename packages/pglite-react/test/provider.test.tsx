import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { waitFor } from '@testing-library/dom'
import React from 'react'
import { PGlite } from '@electric-sql/pglite'
import { live, PGliteWithLive } from '@electric-sql/pglite/live'
import {
  makePGliteProvider,
  PGliteProvider,
  useLiveQuery,
  usePGlite,
} from '../src'

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

  it('makes useLiveQuery available under a typed provider', async () => {
    const initialResults = {
      rows: [{ value: 1 }],
      fields: [{ name: 'value', dataTypeID: 23 }],
    }
    const query = vi.fn(
      (
        _query: string,
        _params: unknown[] | undefined | null,
        callback: (results: typeof initialResults) => void,
      ) => {
        callback(initialResults)
        return Promise.resolve({
          initialResults,
          subscribe: vi.fn(),
          unsubscribe: vi.fn(async () => undefined),
          refresh: vi.fn(async () => undefined),
        })
      },
    )
    const db = { live: { query } } as unknown as PGliteWithLive
    const { PGliteProvider: PGliteProviderTyped } =
      makePGliteProvider<PGliteWithLive>()
    const wrapper = ({ children }: { children: React.ReactNode }) => {
      return <PGliteProviderTyped db={db}>{children}</PGliteProviderTyped>
    }

    const { result } = renderHook(() => useLiveQuery('SELECT 1 AS value'), {
      wrapper,
    })

    await waitFor(() => expect(result.current?.rows).toEqual([{ value: 1 }]))
    expect(query).toHaveBeenCalledWith(
      'SELECT 1 AS value',
      undefined,
      expect.any(Function),
    )
  })
})
