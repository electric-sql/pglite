import { describe, it, expect } from 'vitest'
import { renderHook } from '@solidjs/testing-library'
import { waitFor } from '@testing-library/dom'
import { PGlite } from '@electric-sql/pglite'
import { live, PGliteWithLive } from '@electric-sql/pglite/live'
import { makePGliteProvider, PGliteProvider, usePGlite } from '../src'
import { JSX } from 'solid-js/jsx-runtime'

describe('provider', () => {
  it('can receive PGlite', async () => {
    const db = await PGlite.create({
      extensions: {
        live,
      },
    })
    const wrapper = (props: { children: JSX.Element }) => {
      return <PGliteProvider db={db}>{props.children}</PGliteProvider>
    }

    const { result } = renderHook(() => usePGlite(), { wrapper })

    await waitFor(() => expect(result).toBe(db))
  })

  it('can receive PGlite with typed provider', async () => {
    const db = await PGlite.create({
      extensions: {
        live,
      },
    })

    const { PGliteProvider: PGliteProviderTyped, usePGlite: usePGliteTyped } =
      makePGliteProvider<PGliteWithLive>()

    const wrapper = (props: { children: JSX.Element }) => {
      return <PGliteProviderTyped db={db}>{props.children}</PGliteProviderTyped>
    }

    const { result } = renderHook(() => usePGliteTyped(), { wrapper })

    await waitFor(() => expect(result).toBe(db))
  })
})
