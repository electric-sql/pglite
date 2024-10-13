import 'animate.css/animate.min.css'
import Board from './pages/Board'
import { useState, createContext, useEffect, useMemo } from 'react'
import {
  createBrowserRouter,
  RouterProvider,
  type Params,
} from 'react-router-dom'
import 'react-toastify/dist/ReactToastify.css'
import { live, LiveNamespace } from '@electric-sql/pglite/live'
import { PGliteWorker } from '@electric-sql/pglite/worker'
import { PGliteProvider } from '@electric-sql/pglite-react'
import PGWorker from './pglite-worker.js?worker'
import List from './pages/List'
import Root from './pages/root'
import Issue from './pages/Issue'
import {
  getFilterStateFromSearchParams,
  filterStateToSql,
} from './utils/filterState'
import { Issue as IssueType } from './types/types'

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
    limit: 300,
    // key: 'id',
  })
  return { liveIssues }
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
