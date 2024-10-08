import { PGliteWorker } from '@electric-sql/pglite/worker'
import { Repl } from '@electric-sql/pglite-repl'
import { useEffect, useState } from 'react'
import PGWorker from './pglite-worker.js?worker'
import './App.css'

let pgPromise: Promise<PGliteWorker>

function App() {
  pgPromise ??= PGliteWorker.create(
    new PGWorker({
      name: 'pglite-worker',
    }),
  )
  const [pg, setPg] = useState<PGliteWorker | null>(null)
  useEffect(() => {
    pgPromise.then(setPg)
  }, [])

  return (
    <>
      <h1>
        <a href="https://pglite.dev">PGlite</a> +{' '}
        <a href="https://github.com/electric-sql/pglite/pull/364">
          HttpFs
        </a>
      </h1>
      <div className="intro">
        <p>
          This demo shows how to use <a href="https://pglite.dev">PGlite</a>, a
          WASM build of Postgres running entirely in the browser, with the WIP
          HttpFs to connect to a remote PGlite database. It's using HTTP range
          requests to fetch database file pages from the remote server on
          demand.
        </p>
        <p>
          The database in this demo is the{' '}
          <a href="https://github.com/devrimgunduz/pagila">Pagila</a> sample
          database.
        </p>
        <p>
          The REPL below supports the same <code>\d</code> commands as{' '}
          <code>psql</code>.
        </p>
      </div>
      {pg ? <Repl pg={pg} border={true} /> : <p>Loading...</p>}
    </>
  )
}

export default App
