import { useEffect, useState, useRef } from 'react'
import type { LiveQuery, LiveQueryResults } from '@electric-sql/pglite/live'
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
): Omit<LiveQueryResults<T>, 'affectedRows'> | undefined {
  const db = usePGlite()
  const paramsRef = useRef(params)
  const liveQueryRef = useRef<LiveQuery<T> | undefined>()
  let liveQuery: LiveQuery<T> | undefined
  let liveQueryChanged = false
  if (!(typeof query === 'string') && !(query instanceof Promise)) {
    liveQuery = query
    liveQueryChanged = liveQueryRef.current !== liveQuery
    liveQueryRef.current = liveQuery
  }
  const [results, setResults] = useState<LiveQueryResults<T> | undefined>(
    liveQuery?.initialResults,
  )

  let currentParams = paramsRef.current
  if (!paramsEqual(paramsRef.current, params)) {
    paramsRef.current = params
    currentParams = params
  }

  useEffect(() => {
    let cancelled = false
    const cb = (results: LiveQueryResults<T>) => {
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

  if (liveQueryChanged && liveQuery) {
    return liveQuery.initialResults
  }

  return (
    results && {
      rows: results.rows,
      fields: results.fields,
      totalCount: results.totalCount,
      offset: results.offset,
      limit: results.limit,
    }
  )
}

export function useLiveQuery<T = { [key: string]: unknown }>(
  query: string,
  params?: unknown[] | null,
): LiveQueryResults<T> | undefined

export function useLiveQuery<T = { [key: string]: unknown }>(
  liveQuery: LiveQuery<T>,
): LiveQueryResults<T>

export function useLiveQuery<T = { [key: string]: unknown }>(
  liveQueryPromise: Promise<LiveQuery<T>>,
): LiveQueryResults<T> | undefined

export function useLiveQuery<T = { [key: string]: unknown }>(
  query: string | LiveQuery<T> | Promise<LiveQuery<T>>,
  params?: unknown[] | null,
): LiveQueryResults<T> | undefined {
  return useLiveQueryImpl<T>(query, params)
}

useLiveQuery.sql = function <T = { [key: string]: unknown }>(
  strings: TemplateStringsArray,
  ...values: any[]
): LiveQueryResults<T> | undefined {
  const { query, params } = buildQuery(strings, ...values)
  // eslint-disable-next-line react-compiler/react-compiler
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useLiveQueryImpl<T>(query, params)
}

export function useLiveIncrementalQuery<T = { [key: string]: unknown }>(
  query: string,
  params: unknown[] | undefined | null,
  key: string,
): LiveQueryResults<T> | undefined {
  return useLiveQueryImpl<T>(query, params, key)
}
