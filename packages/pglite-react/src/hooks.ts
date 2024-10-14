import { useEffect, useState, useRef } from 'react'
import { Results } from '@electric-sql/pglite'
import type { LiveQuery } from '@electric-sql/pglite/live'
import { usePGlite } from './provider'
import { query as buildQuery } from '@electric-sql/pglite/template'

function paramsEqual(
  a1: unknown[] | undefined | null,
  a2: unknown[] | undefined | null,
) {
  if (!a1 && !a2) return true
  if (a1?.length !== a2?.length) return false
  for (let i = 0; i < a1!.length; i++) {
    if (!Object.is(a1![i], a2![i])) {
      return false
    }
  }
  return true
}

function useLiveQueryImpl<T = { [key: string]: unknown }>(
  query: string | LiveQuery<T> | Promise<LiveQuery<T>>,
  params: unknown[] | undefined | null,
  key?: string,
): Omit<Results<T>, 'affectedRows'> | undefined {
  const db = usePGlite()
  const paramsRef = useRef(params)
  const liveQueryRef = useRef<LiveQuery<T> | undefined>()
  let liveQuery: LiveQuery<T> | undefined
  if (!(typeof query === 'string') && !(query instanceof Promise)) {
    liveQuery = query
  }
  const [results, setResults] = useState<Results<T> | undefined>(
    liveQuery?.initialResults,
  )

  let currentParams = paramsRef.current
  if (!paramsEqual(paramsRef.current, params)) {
    paramsRef.current = params
    currentParams = params
  }

  useEffect(() => {
    let cancelled = false
    const cb = (results: Results<T>) => {
      if (cancelled) return
      setResults(results)
    }
    if (typeof query === 'string') {
      const ret =
        key !== undefined
          ? db.live.incrementalQuery<T>(query, currentParams, key, cb)
          : db.live.query<T>(query, currentParams, cb)

      return () => {
        cancelled = true
        ret.then(({ unsubscribe }) => unsubscribe())
      }
    } else if (query instanceof Promise) {
      query.then((liveQuery) => {
        if (cancelled) return
        liveQueryRef.current = liveQuery
        setResults(liveQuery.initialResults)
        liveQuery.subscribe(cb)
      })
      return () => {
        cancelled = true
        liveQueryRef.current?.unsubscribe(cb)
      }
    } else if (liveQuery) {
      setResults(liveQuery.initialResults)
      liveQuery.subscribe(cb)
      return () => {
        cancelled = true
        liveQuery.unsubscribe(cb)
      }
    } else {
      throw new Error('Should never happen')
    }
  }, [db, key, query, currentParams, liveQuery])

  return (
    results && {
      rows: results.rows,
      fields: results.fields,
    }
  )
}

export function useLiveQuery<T = { [key: string]: unknown }>(
  query: string,
  params?: unknown[] | null,
): Results<T> | undefined

export function useLiveQuery<T = { [key: string]: unknown }>(
  liveQuery: LiveQuery<T>,
): Results<T>

export function useLiveQuery<T = { [key: string]: unknown }>(
  liveQueryPromise: Promise<LiveQuery<T>>,
): Results<T> | undefined

export function useLiveQuery<T = { [key: string]: unknown }>(
  query: string | LiveQuery<T> | Promise<LiveQuery<T>>,
  params?: unknown[] | null,
): Results<T> | undefined {
  return useLiveQueryImpl<T>(query, params)
}

useLiveQuery.sql = function <T = { [key: string]: unknown }>(
  strings: TemplateStringsArray,
  ...values: any[]
): Results<T> | undefined {
  const { query, params } = buildQuery(strings, ...values)
  // eslint-disable-next-line react-compiler/react-compiler
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useLiveQueryImpl<T>(query, params)
}

export function useLiveIncrementalQuery<T = { [key: string]: unknown }>(
  query: string,
  params: unknown[] | undefined | null,
  key: string,
): Results<T> | undefined {
  return useLiveQueryImpl<T>(query, params, key)
}
