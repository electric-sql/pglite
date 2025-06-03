#!/usr/bin/env node

import { PGlite, DebugLevel } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '../index'
import { parseArgs } from 'node:util'
import { spawn, ChildProcess } from 'node:child_process'

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
    run: {
      type: 'string',
      short: 'r',
      default: undefined,
      help: 'Command to run after server starts',
    },
    'include-database-url': {
      type: 'boolean',
      default: false,
      help: 'Include DATABASE_URL in the environment of the subprocess',
    },
    'shutdown-timeout': {
      type: 'string',
      default: '5000',
      help: 'Timeout in milliseconds for graceful subprocess shutdown (default: 5000)',
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
  -r, --run=COMMAND   Command to run after server starts
  --include-database-url  Include DATABASE_URL in subprocess environment
  --shutdown-timeout=MS   Timeout for graceful subprocess shutdown in ms (default: 5000)
`

// Show help and exit if requested
if (args.values.help) {
  console.log(help)
  process.exit(0)
}

interface ServerConfig {
  dbPath: string
  port: number
  host: string
  path?: string
  debugLevel: DebugLevel
  runCommand?: string
  includeDatabaseUrl: boolean
  shutdownTimeout: number
}

class SubprocessManager {
  private childProcess: ChildProcess | null = null
  private onExit: (code: number) => void

  constructor(onExit: (code: number) => void) {
    this.onExit = onExit
  }

  get process(): ChildProcess | null {
    return this.childProcess
  }

  spawn(command: string, databaseUrl: string, includeDatabaseUrl: boolean): void {
    console.log(`Running command: ${command}`)

    // Prepare environment variables
    const env = { ...process.env }
    if (includeDatabaseUrl) {
      env.DATABASE_URL = databaseUrl
      console.log(`Setting DATABASE_URL=${databaseUrl}`)
    }

    // Parse and spawn the command
    const commandParts = command.trim().split(/\s+/)
    this.childProcess = spawn(commandParts[0], commandParts.slice(1), {
      env,
      stdio: 'inherit',
    })

    this.childProcess.on('error', (error) => {
      console.error('Error running command:', error)
    })

    this.childProcess.on('close', (code) => {
      console.log(`Command exited with code ${code}`)
      this.childProcess = null

      // If child process exits with non-zero code, notify parent
      if (code !== null && code !== 0) {
        console.log(`Child process failed with exit code ${code}, shutting down...`)
        this.onExit(code)
      }
    })
  }

  terminate(timeout: number): void {
    if (this.childProcess) {
      console.log('Terminating child process...')
      this.childProcess.kill('SIGTERM')

      // Give it a moment to exit gracefully, then force kill if needed
      setTimeout(() => {
        if (this.childProcess && !this.childProcess.killed) {
          console.log('Force killing child process...')
          this.childProcess.kill('SIGKILL')
        }
      }, timeout)
    }
  }
}

function createDatabaseUrl(host: string, port: number, path?: string): string {
  if (path) {
    // Unix socket connection
    const socketDir = path.endsWith('/.s.PGSQL.5432') ? path.slice(0, -13) : path
    return `postgresql://postgres:postgres@/postgres?host=${encodeURIComponent(socketDir)}`
  } else {
    // TCP connection
    return `postgresql://postgres:postgres@${host}:${port}/postgres`
  }
}

function parseConfig(): ServerConfig {
  return {
    dbPath: args.values.db as string,
    port: parseInt(args.values.port as string, 10),
    host: args.values.host as string,
    path: args.values.path as string,
    debugLevel: parseInt(args.values.debug as string, 10) as DebugLevel,
    runCommand: args.values.run as string,
    includeDatabaseUrl: args.values['include-database-url'] as boolean,
    shutdownTimeout: parseInt(args.values['shutdown-timeout'] as string, 10),
  }
}

async function initializeDatabase(config: ServerConfig): Promise<PGlite> {
  console.log(`Initializing PGLite with database: ${config.dbPath}`)
  console.log(`Debug level: ${config.debugLevel}`)

  const db = new PGlite(config.dbPath, { debug: config.debugLevel })
  await db.waitReady
  console.log('PGlite database initialized')
  
  return db
}

function setupServerEventHandlers(
  server: PGLiteSocketServer,
  config: ServerConfig,
  subprocessManager: SubprocessManager
) {
  server.addEventListener('listening', (event) => {
    const detail = (
      event as CustomEvent<{ port: number; host: string } | { host: string }>
    ).detail
    console.log(`PGLiteSocketServer listening on ${JSON.stringify(detail)}`)

    // Run the command after server starts listening
    if (config.runCommand) {
      const databaseUrl = createDatabaseUrl(config.host, config.port, config.path)
      subprocessManager.spawn(config.runCommand, databaseUrl, config.includeDatabaseUrl)
    }
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
}

// Main function to start the server
async function main() {
  try {
    const config = parseConfig()
    const db = await initializeDatabase(config)

    // Create and start the socket server
    const server = new PGLiteSocketServer({
      db,
      port: config.port,
      host: config.host,
      path: config.path,
      inspect: config.debugLevel > 0,
    })

    // Create subprocess manager
    const subprocessManager = new SubprocessManager((exitCode) => {
      shutdown(exitCode)
    })

    // Setup server event handlers
    setupServerEventHandlers(server, config, subprocessManager)

    // Start the server
    await server.start()

    // Handle process termination to stop the server gracefully
    const shutdown = async (exitCode: number = 0) => {
      console.log('\nShutting down PGLiteSocketServer...')
      subprocessManager.terminate(config.shutdownTimeout)
      await server.stop()
      await db.close()
      console.log('Server stopped')
      process.exit(exitCode)
    }

    process.on('SIGINT', () => shutdown())
    process.on('SIGTERM', () => shutdown())
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
