import {
  watch,
  WatchSource,
  readonly,
  DeepReadonly,
  shallowReactive,
  toRefs,
  ToRefs,
  shallowRef,
  onScopeDispose,
  ref,
  isRef,
  unref,
} from 'vue-demi'
import { Results } from '@electric-sql/pglite'
import { query as buildQuery } from '@electric-sql/pglite/template'
import { injectPGlite } from './dependency-injection'

type UnsubscribeFn = () => Promise<void>
type QueryParams = unknown[] | undefined | null
type QueryResult<T> =
  | Omit<Results<T>, 'affectedRows'>
  | { rows: undefined; fields: undefined; blob: undefined }
type LiveQueryResults<T> = ToRefs<DeepReadonly<QueryResult<T>>>

function useLiveQueryImpl<T = { [key: string]: unknown }>(
  query: string | WatchSource<string>,
  params?: QueryParams | WatchSource<QueryParams> | WatchSource<unknown>[],
  key?: string | WatchSource<string>,
): LiveQueryResults<T> {
  const db = injectPGlite()!

  const liveUpdate = shallowReactive<
    | Omit<Results<T>, 'affectedRows'>
    | { rows: undefined; fields: undefined; blob: undefined }
  >({
    rows: undefined,
    fields: undefined,
    blob: undefined,
  })

  // keep track of live query subscriptions to unsubscribe when scope is disposed
  const unsubscribeRef = shallowRef<UnsubscribeFn>()

  const querySource = typeof query === 'string' ? ref(query) : query
  const paramsSources = !params
    ? [ref(params)]
    : Array.isArray(params)
      ? params.map(ref)
      : [params]

  const keySource = typeof key === 'string' ? ref(key) : key

  watch(
    key !== undefined
      ? [querySource, keySource, ...paramsSources]
      : [querySource, ...paramsSources],
    () => {
      let cancelled = false
      const cb = (results: Results<T>) => {
        if (cancelled) return
        liveUpdate.rows = results.rows
        liveUpdate.fields = results.fields
        if (results.blob !== undefined) {
          liveUpdate.blob = results.blob
        }
      }

      const query = isRef(querySource) ? unref(querySource) : querySource()

      const paramVals = isRef(params)
        ? unref(params)
        : typeof params === 'function'
          ? params()
          : Array.isArray(params)
            ? params.map(unref)
            : [params]

      const key = isRef(keySource) ? keySource.value : keySource?.()

      const ret =
        key !== undefined
          ? db.live.incrementalQuery<T>(query, paramVals, key, cb)
          : db.live.query<T>(query, paramVals, cb)

      unsubscribeRef.value = () => {
        cancelled = true
        return ret.then(({ unsubscribe }) => unsubscribe())
      }
    },
    { immediate: true },
  )

  onScopeDispose(() => unsubscribeRef.value?.())

  // @ts-ignore vue v2 has issues with DeepReadonly mapping
  return toRefs(readonly(liveUpdate))
}

export function useLiveQuery<T = { [key: string]: unknown }>(
  query: string | WatchSource<string>,
  params?: QueryParams | WatchSource<QueryParams> | WatchSource<unknown>[],
): LiveQueryResults<T> {
  return useLiveQueryImpl<T>(query, params)
}

useLiveQuery.sql = function <T = { [key: string]: unknown }>(
  strings: TemplateStringsArray,
  ...values: any[]
): LiveQueryResults<T> {
  const { query, params } = buildQuery(strings, ...values)
  return useLiveQueryImpl<T>(query, params)
}

export function useLiveIncrementalQuery<T = { [key: string]: unknown }>(
  query: string | WatchSource<string>,
  params: QueryParams | WatchSource<QueryParams> | WatchSource<unknown>[],
  key: string | WatchSource<string>,
): LiveQueryResults<T> {
  return useLiveQueryImpl<T>(query, params, key)
}
