import 'animate.css/animate.min.css'
import Board from './pages/Board'
import { useState, createContext, useEffect, useMemo } from 'react'
import {
  createBrowserRouter,
  RouterProvider,
  type Params,
} from 'react-router-dom'
import 'react-toastify/dist/ReactToastify.css'
import { live, LiveNamespace, LiveQuery } from '@electric-sql/pglite/live'
import { PGliteWorker } from '@electric-sql/pglite/worker'
import { PGliteProvider } from '@electric-sql/pglite-react'
import PGWorker from './pglite-worker.js?worker'
import List from './pages/List'
import Root from './pages/root'
import Issue from './pages/Issue'
import {
  getFilterStateFromSearchParams,
  filterStateToSql,
  FilterState,
} from './utils/filterState'
import { Issue as IssueType, Status, StatusValue } from './types/types'

interface MenuContextInterface {
  showMenu: boolean
  setShowMenu: (show: boolean) => void
}

export const MenuContext = createContext(null as MenuContextInterface | null)

type PGliteWorkerWithLive = PGliteWorker & { live: LiveNamespace }

const pgPromise = PGliteWorker.create(new PGWorker(), {
  extensions: {
    live,
  },
})

async function issueListLoader({ request }: { request: Request }) {
  const pg = await pgPromise
  const url = new URL(request.url)
  const filterState = getFilterStateFromSearchParams(url.searchParams)
  const { sql, sqlParams } = filterStateToSql(filterState)
  // const liveIssues = await pg.live.incrementalQuery<IssueType>({
  const liveIssues = await pg.live.query<IssueType>({
    query: sql,
    params: sqlParams,
    signal: request.signal,
    offset: 0,
    limit: 100,
    // key: 'id',
  })
  return { liveIssues, filterState }
}

async function boardIssueListLoader({ request }: { request: Request }) {
  const pg = await pgPromise
  const url = new URL(request.url)
  const filterState = getFilterStateFromSearchParams(url.searchParams)

  const columnsLiveIssues: Partial<Record<StatusValue, LiveQuery<IssueType>>> =
    {}

  for (const status of Object.values(Status)) {
    const colFilterState: FilterState = {
      ...filterState,
      orderBy: 'kanbanorder',
      orderDirection: 'asc',
      status: [status],
    }
    const { sql: colSql, sqlParams: colSqlParams } =
      filterStateToSql(colFilterState)
    const colLiveIssues = await pg.live.query<IssueType>({
      query: colSql,
      params: colSqlParams,
      signal: request.signal,
      offset: 0,
      limit: 10,
      // key: 'id',
    })
    columnsLiveIssues[status] = colLiveIssues
  }

  return {
    columnsLiveIssues: columnsLiveIssues as Record<
      StatusValue,
      LiveQuery<IssueType>
    >,
    filterState,
  }
}

async function issueLoader({
  params,
  request,
}: {
  params: Params
  request: Request
}) {
  const pg = await pgPromise
  const liveIssue = await pg.live.query<IssueType>({
    query: `SELECT * FROM issue WHERE id = $1`,
    params: [params.id],
    signal: request.signal,
  })
  return { liveIssue }
}

const router = createBrowserRouter([
  {
    path: `/`,
    element: <Root />,
    children: [
      {
        path: `/`,
        element: <List />,
        loader: issueListLoader,
      },
      {
        path: `/search`,
        element: <List showSearch={true} />,
        loader: issueListLoader,
      },
      {
        path: `/board`,
        element: <Board />,
        loader: boardIssueListLoader,
      },
      {
        path: `/issue/:id`,
        element: <Issue />,
        loader: issueLoader,
      },
    ],
  },
])

const App = () => {
  const [showMenu, setShowMenu] = useState(false)
  const [pgForProvider, setPgForProvider] =
    useState<PGliteWorkerWithLive | null>(null)

  useEffect(() => {
    pgPromise.then(setPgForProvider)
  }, [])

  const menuContextValue = useMemo(
    () => ({ showMenu, setShowMenu }),
    [showMenu]
  )

  if (!pgForProvider) return <div>Loading...</div>

  return (
    <PGliteProvider db={pgForProvider}>
      <MenuContext.Provider value={menuContextValue}>
        <RouterProvider router={router} />
      </MenuContext.Provider>
    </PGliteProvider>
  )
}

export default App
