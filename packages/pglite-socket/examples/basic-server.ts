import { PGlitePostmaster } from '@electric-sql/pglite/postmaster'
import { PGliteSocketServer } from '../src/index.js'

const port = process.env.PORT ? Number(process.env.PORT) : 5432
const postmaster = await PGlitePostmaster.create({
  dataDir: process.env.PGDATA ?? 'file://./pglite-socket-example-data',
  maxConnections: 20,
  debug: process.env.DEBUG === '1',
})
const server = new PGliteSocketServer({
  postmaster,
  listen: process.env.UNIX
    ? { path: process.env.UNIX }
    : { host: process.env.HOST ?? '127.0.0.1', port },
  debug: process.env.DEBUG === '1',
})

console.log('PGlite socket frontend ready:', await server.start())

process.once('SIGINT', async () => {
  await server.stop()
  await postmaster.close()
})
