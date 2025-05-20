#!/usr/bin/env node

import { PGlite, DebugLevel } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '../index'
import { parseArgs } from 'node:util'

// Define command line argument options
const args = parseArgs({
  options: {
    db: {
      type: 'string',
      short: 'd',
      default: 'memory://',
      help: 'Database path (relative or absolute). Use memory:// for in-memory database.',
    },
    port: {
      type: 'string',
      short: 'p',
      default: '5432',
      help: 'Port to listen on',
    },
    host: {
      type: 'string',
      short: 'h',
      default: '127.0.0.1',
      help: 'Host to bind to',
    },
    path: {
      type: 'string',
      short: 'u',
      default: undefined,
      help: 'unix socket to bind to. Takes precedence over host:port',
    },
    debug: {
      type: 'string',
      short: 'v',
      default: '0',
      help: 'Debug level (0-5)',
    },
    help: {
      type: 'boolean',
      short: '?',
      default: false,
      help: 'Show help',
    },
  },
})

const help = `PGlite Socket Server
Usage: pglite-server [options]

Options:
  -d, --db=PATH       Database path (default: memory://)
  -p, --port=PORT     Port to listen on (default: 5432)
  -h, --host=HOST     Host to bind to (default: 127.0.0.1)
  -u, --path=UNIX     Unix socket to bind to (default: undefined). Takes precedence over host:port
  -v, --debug=LEVEL   Debug level 0-5 (default: 0)
`

// Show help and exit if requested
if (args.values.help) {
  console.log(help)
  process.exit(0)
}

// Main function to start the server
async function main() {
  try {
    // Parse arguments
    const dbPath = args.values.db as string
    const port = parseInt(args.values.port as string, 10)
    const host = args.values.host as string
    const path = args.values.path as string
    const debugStr = args.values.debug as string
    const debugLevel = parseInt(debugStr, 10) as DebugLevel

    console.log(`Initializing PGLite with database: ${dbPath}`)
    console.log(`Debug level: ${debugLevel}`)

    // Create PGlite instance
    const db = new PGlite(dbPath, { debug: debugLevel })

    // Wait for PGlite to be ready
    await db.waitReady
    console.log('PGlite database initialized')

    // Create and start the socket server
    const server = new PGLiteSocketServer({
      db,
      port,
      host,
      path,
      inspect: debugLevel > 0,
    })

    // Listen for server events
    server.addEventListener('listening', (event) => {
      const detail = (
        event as CustomEvent<{ port: number; host: string } | { host: string }>
      ).detail
      console.log(`PGLiteSocketServer listening on ${JSON.stringify(detail)}`)
    })

    server.addEventListener('connection', (event) => {
      const { clientAddress, clientPort } = (
        event as CustomEvent<{ clientAddress: string; clientPort: number }>
      ).detail
      console.log(`Client connected from ${clientAddress}:${clientPort}`)
    })

    server.addEventListener('error', (event) => {
      const error = (event as CustomEvent<Error>).detail
      console.error('Socket server error:', error)
    })

    // Start the server
    await server.start()

    // Handle process termination to stop the server gracefully
    const shutdown = async () => {
      console.log('\nShutting down PGLiteSocketServer...')
      await server.stop()
      await db.close()
      console.log('Server stopped')
      process.exit(0)
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  } catch (error) {
    console.error('Failed to start PGLiteSocketServer:', error)
    process.exit(1)
  }
}

// Run the main function
main().catch((error) => {
  console.error('Unhandled error:', error)
  process.exit(1)
})
