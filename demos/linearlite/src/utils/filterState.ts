import { useSearchParams } from 'react-router-dom'

interface FilterState {
  orderBy: string
  orderDirection: `asc` | `desc`
  status?: string[]
  priority?: string[]
  query?: string
}

export function getFilterStateFromSearchParams(
  searchParams: URLSearchParams
): FilterState {
  const orderBy = searchParams.get(`orderBy`) ?? `created`
  const orderDirection =
    (searchParams.get(`orderDirection`) as `asc` | `desc`) ?? `desc`
  const status = searchParams
    .getAll(`status`)
    .map((status) => status.toLocaleLowerCase().split(`,`))
    .flat()
  const priority = searchParams
    .getAll(`priority`)
    .map((status) => status.toLocaleLowerCase().split(`,`))
    .flat()
  const query = searchParams.get(`query`)

  const state = {
    orderBy,
    orderDirection,
    status,
    priority,
    query: query || undefined,
  }

  return state
}

export function useFilterState(): [
  FilterState,
  (state: Partial<FilterState>) => void,
] {
  const [searchParams, setSearchParams] = useSearchParams()
  const state = getFilterStateFromSearchParams(searchParams)

  const setState = (state: Partial<FilterState>) => {
    const { orderBy, orderDirection, status, priority, query } = state
    setSearchParams((searchParams) => {
      if (orderBy) {
        searchParams.set(`orderBy`, orderBy)
      } else {
        searchParams.delete(`orderBy`)
      }
      if (orderDirection) {
        searchParams.set(`orderDirection`, orderDirection)
      } else {
        searchParams.delete(`orderDirection`)
      }
      if (status && status.length > 0) {
        searchParams.set(`status`, status.join(`,`))
      } else {
        searchParams.delete(`status`)
      }
      if (priority && priority.length > 0) {
        searchParams.set(`priority`, priority.join(`,`))
      } else {
        searchParams.delete(`priority`)
      }
      if (query) {
        searchParams.set(`query`, query)
      } else {
        searchParams.delete(`query`)
      }
      return searchParams
    })
  }

  return [state, setState]
}

export function filterStateToSql(filterState: FilterState) {
  let i = 1
  const sqlWhere = []
  const sqlParams = []
  if (filterState.status?.length) {
    sqlWhere.push(
      `status IN (${filterState.status.map(() => `$${i++}`).join(' ,')})`
    )
    sqlParams.push(...filterState.status)
  }
  if (filterState.priority?.length) {
    sqlWhere.push(
      `priority IN (${filterState.priority.map(() => `$${i++}`).join(' ,')})`
    )
    sqlParams.push(...filterState.priority)
  }
  if (filterState.query) {
    sqlWhere.push(`title ILIKE $${i++}`)
    sqlParams.push(filterState.query)
  }
  const sql = `
    SELECT * FROM issue
    ${sqlWhere.length ? `WHERE ${sqlWhere.join(' AND ')}` : ''}
    ORDER BY ${filterState.orderBy} ${filterState.orderDirection}
  `
  return { sql, sqlParams }
}
