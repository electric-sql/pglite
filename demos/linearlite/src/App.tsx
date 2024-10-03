import 'animate.css/animate.min.css'
import Board from './pages/Board'
import { useState, createContext, useEffect } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import 'react-toastify/dist/ReactToastify.css'
import { live, LiveNamespace } from '@electric-sql/pglite/live'
import { PGliteWorker } from '@electric-sql/pglite/worker'
import { PGliteProvider } from '@electric-sql/pglite-react'
import PGWorker from './pglite-worker.js?worker'
import List from './pages/List'
import Root from './pages/root'
import Issue from './pages/Issue'

interface MenuContextInterface {
  showMenu: boolean
  setShowMenu: (show: boolean) => void
}

export const MenuContext = createContext(null as MenuContextInterface | null)

type PGliteWorkerWithLive = PGliteWorker & { live: LiveNamespace }

let pgPromise: Promise<PGliteWorkerWithLive>

const router = createBrowserRouter([
  {
    path: `/`,
    element: <Root />,
    children: [
      {
        path: `/`,
        element: <List />,
      },
      {
        path: `/search`,
        element: <List showSearch={true} />,
      },
      {
        path: `/board`,
        element: <Board />,
      },
      {
        path: `/issue/:id`,
        element: <Issue />,
      },
    ],
  },
])

const App = () => {
  const [showMenu, setShowMenu] = useState(false)
  const [pg, setPg] = useState<PGliteWorkerWithLive | null>(null)

  useEffect(() => {
    console.time(`preload`)
    if (!pgPromise) {
      pgPromise = PGliteWorker.create(new PGWorker(), {
        extensions: {
          live,
        },
      })
    }
    pgPromise.then(setPg)
    console.timeEnd(`preload`)
  }, [])

  if (!pg) return <div>Loading...</div>

  return (
    <PGliteProvider db={pg}>
      <MenuContext.Provider value={{ showMenu, setShowMenu }}>
        <RouterProvider router={router} />
      </MenuContext.Provider>
    </PGliteProvider>
  )
}

export default App
