import { useEffect, useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import pgliteLogo from '/pglite.svg'
import typescriptLogo from '/typescript.svg'
import './App.css'
import { PGliteProvider } from '@electric-sql/pglite-react'
import MyPGliteComponent from './MyPGliteComponent'
import { live, PGliteWithLive } from '@electric-sql/pglite/live'
import { PGlite } from '@electric-sql/pglite'

function App() {

  const [db, setDb] = useState<PGliteWithLive | undefined>();

  useEffect(() => {
    async function setupDb() {
      const db = await PGlite.create({
        extensions: { live }
      })
      db.query(`CREATE TABLE IF NOT EXISTS my_table (
        id SERIAL PRIMARY KEY NOT NULL,
        name TEXT,
        number INT,
        "insertDateTime" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );`)
      setDb(db)
    }
    setupDb()
  }, [])

  return (
    <>
      <div>
        <a href="https://pglite.dev" target="_blank">
          <img src={pgliteLogo} className="logo" alt="PGlite logo" />
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
      <h1>PGlite with Vite + React + TS</h1>
      <p className="read-the-docs">
        Click on the logos to learn more
      </p>      
      <div className="card">
        {/* see details https://pglite.dev/docs/framework-hooks/react#pgliteprovider */}
        <PGliteProvider db={db}>
          <MyPGliteComponent/>
        </PGliteProvider>
      </div>
    </>
  )
}

export default App
