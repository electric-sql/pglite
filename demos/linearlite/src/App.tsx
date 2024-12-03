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
import { startSync, useSyncStatus, waitForInitialSyncDone } from './sync'
import { electricSync } from '@electric-sql/pglite-sync'
import { ImSpinner8 } from 'react-icons/im'

interface MenuContextInterface {
  showMenu: boolean
  setShowMenu: (show: boolean) => void
}

export const MenuContext = createContext(null as MenuContextInterface | null)

type PGliteWorkerWithLive = PGliteWorker & { live: LiveNamespace }

async function createPGlite() {
  return PGliteWorker.create(new PGWorker(), {
    extensions: {
      live,
      sync: electricSync(),
    },
  })
}

const pgPromise = createPGlite()

let syncStarted = false
pgPromise.then(async (pg) => {
  console.log('PGlite worker started')
  pg.onLeaderChange(() => {
    console.log('Leader changed, isLeader:', pg.isLeader)
    if (pg.isLeader && !syncStarted) {
      syncStarted = true
      startSync(pg)
    }
  })
})

let resolveFirstLoaderPromise: (value: void | PromiseLike<void>) => void
const firstLoaderPromise = new Promise<void>((resolve) => {
  resolveFirstLoaderPromise = resolve
})

async function issueListLoader({ request }: { request: Request }) {
  await waitForInitialSyncDone()
  const pg = await pgPromise
  const url = new URL(request.url)
  const filterState = getFilterStateFromSearchParams(url.searchParams)
  const { sql, sqlParams } = filterStateToSql(filterState)
  const liveIssues = await pg.live.query<IssueType>({
    query: sql,
    params: sqlParams,
    signal: request.signal,
    offset: 0,
    limit: 100,
  })
  resolveFirstLoaderPromise()
  return { liveIssues, filterState }
}

async function boardIssueListLoader({ request }: { request: Request }) {
  await waitForInitialSyncDone()
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
    })
    columnsLiveIssues[status] = colLiveIssues
  }

  resolveFirstLoaderPromise()

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

const LoadingScreen = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center gap-4">
      <ImSpinner8 className="w-8 h-8 animate-spin text-blue-500" />
      <div className="text-gray-600 text-center" style={{ minHeight: '100px' }}>
        {children}
      </div>
    </div>
  )
}

const App = () => {
  const [showMenu, setShowMenu] = useState(false)
  const [pgForProvider, setPgForProvider] =
    useState<PGliteWorkerWithLive | null>(null)
  const [syncStatus, syncMessage] = useSyncStatus()
  const [firstLoaderDone, setFirstLoaderDone] = useState(false)

  useEffect(() => {
    pgPromise.then(setPgForProvider)
  }, [])

  useEffect(() => {
    if (firstLoaderDone) return
    firstLoaderPromise.then(() => {
      setFirstLoaderDone(true)
    })
  }, [firstLoaderDone])

  const menuContextValue = useMemo(
    () => ({ showMenu, setShowMenu }),
    [showMenu]
  )

  if (!pgForProvider) return <LoadingScreen>Starting PGlite...</LoadingScreen>

  if (syncStatus === 'initial-sync')
    return (
      <LoadingScreen>
        Performing initial sync...
        <br />
        {syncMessage}
      </LoadingScreen>
    )

  if (!firstLoaderDone) return <LoadingScreen>Loading...</LoadingScreen>

  return (
    <PGliteProvider db={pgForProvider}>
      <MenuContext.Provider value={menuContextValue}>
        <RouterProvider router={router} />
      </MenuContext.Provider>
    </PGliteProvider>
  )
}

export default App
