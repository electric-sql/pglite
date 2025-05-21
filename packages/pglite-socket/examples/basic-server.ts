import { PGLiteSocketServer } from '../src'
import { PGlite, DebugLevel } from '@electric-sql/pglite'

/*
 * This is a basic example of how to use the PGLiteSocketServer class.
 * It creates a PGlite instance and a PGLiteSocketServer instance and starts the server.
 * It also handles SIGINT to stop the server and close the database.
 * You can run this example with the following command:
 *
 * ```bash
 * pnpm tsx examples/basic-server.ts
 * ```
 * or with the handy script:
 * ```bash
 * pnpm example:basic-server
 * ```
 *
 * You can set the host and port with the following environment variables:
 *
 * ```bash
 * HOST=127.0.0.1 PORT=5432 DEBUG=1 pnpm tsx examples/basic-server.ts
 * ```
 *
 * Debug level can be set to 0, 1, 2, 3, or 4.
 *
 * ```bash
 * DEBUG=1 pnpm tsx examples/basic-server.ts
 * ```
 * You can also use a UNIX socket instead of the host:port
 * 
 * ```bash
 * UNIX=/tmp/.s.PGSQL.5432 DEBUG=1 pnpm tsx examples/basic-server.ts
 * ```
 */

const UNIX = process.env.UNIX
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 5432
const HOST = process.env.HOST ?? '127.0.0.1'
const DEBUG = process.env.DEBUG
  ? (parseInt(process.env.DEBUG) as DebugLevel)
  : 0

// Create a PGlite instance
const db = await PGlite.create({
  debug: DEBUG,
})

// Check if the database is working
console.log(await db.query('SELECT version()'))

// Create a PGLiteSocketServer instance
const server = new PGLiteSocketServer({
  db,
  port: PORT,
  host: HOST,
  path: UNIX,
  inspect: !!DEBUG, // Print the incoming and outgoing data to the console
})

server.addEventListener('listening', (event) => {
  const detail = (
    event as CustomEvent<{ port: number; host: string } | { host: string }>
  ).detail
  console.log(`Server listening on ${JSON.stringify(detail)}`)
})

// Start the server
await server.start()

// Handle SIGINT to stop the server and close the database
process.on('SIGINT', async () => {
  await server.stop()
  await db.close()
  console.log('Server stopped and database closed')
  process.exit(0)
})
