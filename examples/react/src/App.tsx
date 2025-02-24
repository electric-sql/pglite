import { useEffect, useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import pgliteLogoLight from '/pglite-logo-light.svg'
import typescriptLogo from '/typescript.svg'
import './App.css'
import { PGliteProvider } from '@electric-sql/pglite-react'
import MyPGliteComponent from './MyPGliteComponent'
import { live, PGliteWithLive } from '@electric-sql/pglite/live'
import { PGlite } from '@electric-sql/pglite'

let dbGlobal: PGliteWithLive | undefined

function App() {
  const [db, setDb] = useState<PGliteWithLive | undefined>()

  useEffect(() => {
    async function setupDb() {
      // Initialising a PGlite instance in a useEffect hook is a good pattern.
      // However, it doesn't play well with React's strict mode, so we'll use a global
      // variable to store the instance once it's initialised. That way strict mode
      // doesn't re-initialise it.
      dbGlobal ??= await PGlite.create({
        extensions: { live },
      })
      dbGlobal.query(`CREATE TABLE IF NOT EXISTS my_table (
        id SERIAL PRIMARY KEY NOT NULL,
        name TEXT,
        number INT,
        "insertDateTime" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );`)
      setDb(dbGlobal)
    }
    setupDb()
  }, [])

  return (
    <>
      <div>
        <a href="https://pglite.dev" target="_blank">
          <img src={pgliteLogoLight} className="logo" alt="PGlite logo" />
        </a>
        <a href="https://vite.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev/" target="_blank">
          <img src={reactLogo} className="logo" alt="React logo" />
        </a>
        <a href="https://www.typescriptlang.org/" target="_blank">
          <img src={typescriptLogo} className="logo" alt="Typescript logo" />
        </a>
      </div>
      <h1>PGlite example with Vite + React + TS</h1>
      <p className="read-the-docs">Click on the logos to learn more</p>
      <p>
        This example demonstrates the usage of some of PGlite's React API:{' '}
        <a href="https://pglite.dev/docs/framework-hooks/react#pgliteprovider">
          PGliteProvider
        </a>
        ,{' '}
        <a href="https://pglite.dev/docs/framework-hooks/react#usepglite">
          usePGlite
        </a>
        ,{' '}
        <a href="https://pglite.dev/docs/framework-hooks/react#uselivequery">
          useLiveQuery
        </a>
        .
      </p>
      <p>
        On page load, a database is created with a single table. On pressing the
        button, a new row is inserted into the database. The{' '}
        <a href="https://pglite.dev/docs/framework-hooks/react#uselivequery">
          useLiveQuery
        </a>{' '}
        will watch for any changes and display the most recently inserted 5
        rows.
      </p>
      <div className="card">
        {/* see details https://pglite.dev/docs/framework-hooks/react#pgliteprovider */}
        {db ? (
          <PGliteProvider db={db}>
            <MyPGliteComponent />
          </PGliteProvider>
        ) : (
          <div>Loading PGlite...</div>
        )}
      </div>
    </>
  )
}

export default App
