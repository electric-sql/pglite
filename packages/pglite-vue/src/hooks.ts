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
} from 'vue-demi'
import { Results } from '@electric-sql/pglite'
import { injectPGliteUntyped } from './dependency-injection'

type UnsubscribeFn = () => Promise<void>
type QueryParams = unknown[] | undefined | null
type QueryResult<T> =
  | Omit<Results<T>, 'affectedRows'>
  | { rows: undefined; fields: undefined; blob: undefined }
type LiveQueryResults<T> = ToRefs<DeepReadonly<QueryResult<T>>>

function useLiveQueryImpl<T = { [key: string]: unknown }>(
  query: string | WatchSource<string>,
  params?: QueryParams | WatchSource<QueryParams>,
  key?: string | WatchSource<string>,
): LiveQueryResults<T> | undefined {
  const db = injectPGliteUntyped()!

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
  const paramsSource =
    !isRef(params) && typeof params !== 'function' ? ref(params) : params
  const keySource = typeof key === 'string' ? ref(key) : key

  watch(
    key !== undefined
      ? [querySource, paramsSource, keySource]
      : [querySource, paramsSource],
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

      const query = isRef(querySource) ? querySource.value : querySource()
      const params = isRef(paramsSource) ? paramsSource.value : paramsSource()
      const key = isRef(keySource) ? keySource.value : keySource?.()

      const ret =
        key !== undefined
          ? db.live.incrementalQuery<T>(query, params, key, cb)
          : db.live.query<T>(query, params, cb)

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
  params?: QueryParams | WatchSource<QueryParams>,
): LiveQueryResults<T> | undefined {
  return useLiveQueryImpl<T>(query, params)
}

export function useLiveIncrementalQuery<T = { [key: string]: unknown }>(
  query: string | WatchSource<string>,
  params: QueryParams | WatchSource<QueryParams>,
  key: string | WatchSource<string>,
): LiveQueryResults<T> | undefined {
  return useLiveQueryImpl<T>(query, params, key)
}
