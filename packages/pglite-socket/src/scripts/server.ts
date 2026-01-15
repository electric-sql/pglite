#!/usr/bin/env node

import { PGlite, DebugLevel } from '@electric-sql/pglite'
import type { Extension, Extensions } from '@electric-sql/pglite'
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
    extensions: {
      type: 'string',
      short: 'e',
      default: undefined,
      help: 'Comma-separated list of extensions to load (e.g., vector,pgcrypto)',
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
  -e, --extensions=LIST  Comma-separated list of extensions to load
                         Formats: vector, pgcrypto (built-in/contrib)
                                  @org/package/path:exportedName (npm package)
  -r, --run=COMMAND   Command to run after server starts
  --include-database-url  Include DATABASE_URL in subprocess environment
  --shutdown-timeout=MS   Timeout for graceful subprocess shutdown in ms (default: 5000)
`

interface ServerConfig {
  dbPath: string
  port: number
  host: string
  path?: string
  debugLevel: DebugLevel
  extensionNames?: string[]
  runCommand?: string
  includeDatabaseUrl: boolean
  shutdownTimeout: number
}

class PGLiteServerRunner {
  private config: ServerConfig
  private db: PGlite | null = null
  private server: PGLiteSocketServer | null = null
  private subprocessManager: SubprocessManager | null = null

  constructor(config: ServerConfig) {
    this.config = config
  }

  static parseConfig(): ServerConfig {
    const extensionsArg = args.values.extensions as string | undefined
    return {
      dbPath: args.values.db as string,
      port: parseInt(args.values.port as string, 10),
      host: args.values.host as string,
      path: args.values.path as string,
      debugLevel: parseInt(args.values.debug as string, 10) as DebugLevel,
      extensionNames: extensionsArg
        ? extensionsArg.split(',').map((e) => e.trim())
        : undefined,
      runCommand: args.values.run as string,
      includeDatabaseUrl: args.values['include-database-url'] as boolean,
      shutdownTimeout: parseInt(args.values['shutdown-timeout'] as string, 10),
    }
  }

  private createDatabaseUrl(): string {
    const { host, port, path } = this.config

    if (path) {
      // Unix socket connection
      const socketDir = path.endsWith('/.s.PGSQL.5432')
        ? path.slice(0, -13)
        : path
      return `postgresql://postgres:postgres@/postgres?host=${encodeURIComponent(socketDir)}`
    } else {
      // TCP connection
      return `postgresql://postgres:postgres@${host}:${port}/postgres`
    }
  }

  private async importExtensions(): Promise<Extensions | undefined> {
    if (!this.config.extensionNames?.length) {
      return undefined
    }

    const extensions: Extensions = {}

    // Built-in extensions that are not in contrib
    const builtInExtensions = [
      'vector',
      'live',
      'pg_hashids',
      'pg_ivm',
      'pg_uuidv7',
      'pgtap',
    ]

    for (const name of this.config.extensionNames) {
      let ext: Extension | null = null

      try {
        // Check if this is a custom package path (contains ':')
        // Format: @org/package/path:exportedName or package/path:exportedName
        if (name.includes(':')) {
          const [packagePath, exportName] = name.split(':')
          if (!packagePath || !exportName) {
            throw new Error(
              `Invalid extension format '${name}'. Expected: package/path:exportedName`,
            )
          }
          const mod = await import(packagePath)
          ext = mod[exportName] as Extension
          if (ext) {
            extensions[exportName] = ext
            console.log(
              `Imported extension '${exportName}' from '${packagePath}'`,
            )
          }
        } else if (builtInExtensions.includes(name)) {
          // Built-in extension (e.g., @electric-sql/pglite/vector)
          const mod = await import(`@electric-sql/pglite/${name}`)
          ext = mod[name] as Extension
          if (ext) {
            extensions[name] = ext
            console.log(`Imported extension: ${name}`)
          }
        } else {
          // Try contrib first (e.g., @electric-sql/pglite/contrib/pgcrypto)
          try {
            const mod = await import(`@electric-sql/pglite/contrib/${name}`)
            ext = mod[name] as Extension
          } catch {
            // Fall back to external package (e.g., @electric-sql/pglite-<extension>)
            const mod = await import(`@electric-sql/pglite-${name}`)
            ext = mod[name] as Extension
          }
          if (ext) {
            extensions[name] = ext
            console.log(`Imported extension: ${name}`)
          }
        }
      } catch (error) {
        console.error(`Failed to import extension '${name}':`, error)
        throw new Error(`Failed to import extension '${name}'`)
      }
    }

    return Object.keys(extensions).length > 0 ? extensions : undefined
  }

  private async initializeDatabase(): Promise<void> {
    console.log(`Initializing PGLite with database: ${this.config.dbPath}`)
    console.log(`Debug level: ${this.config.debugLevel}`)

    const extensions = await this.importExtensions()

    this.db = new PGlite(this.config.dbPath, {
      debug: this.config.debugLevel,
      extensions,
    })
    await this.db.waitReady
    console.log('PGlite database initialized')
  }

  private setupServerEventHandlers(): void {
    if (!this.server || !this.subprocessManager) {
      throw new Error('Server or subprocess manager not initialized')
    }

    this.server.addEventListener('listening', (event) => {
      const detail = (
        event as CustomEvent<{ port: number; host: string } | { host: string }>
      ).detail
      console.log(`PGLiteSocketServer listening on ${JSON.stringify(detail)}`)

      // Run the command after server starts listening
      if (this.config.runCommand && this.subprocessManager) {
        const databaseUrl = this.createDatabaseUrl()
        this.subprocessManager.spawn(
          this.config.runCommand,
          databaseUrl,
          this.config.includeDatabaseUrl,
        )
      }
    })

    this.server.addEventListener('connection', (event) => {
      const { clientAddress, clientPort } = (
        event as CustomEvent<{ clientAddress: string; clientPort: number }>
      ).detail
      console.log(`Client connected from ${clientAddress}:${clientPort}`)
    })

    this.server.addEventListener('error', (event) => {
      const error = (event as CustomEvent<Error>).detail
      console.error('Socket server error:', error)
    })
  }

  private setupSignalHandlers(): void {
    process.on('SIGINT', () => this.shutdown())
    process.on('SIGTERM', () => this.shutdown())
  }

  async start(): Promise<void> {
    try {
      // Initialize database
      await this.initializeDatabase()

      if (!this.db) {
        throw new Error('Database initialization failed')
      }

      // Create and setup the socket server
      this.server = new PGLiteSocketServer({
        db: this.db,
        port: this.config.port,
        host: this.config.host,
        path: this.config.path,
        inspect: this.config.debugLevel > 0,
      })

      // Create subprocess manager
      this.subprocessManager = new SubprocessManager((exitCode) => {
        this.shutdown(exitCode)
      })

      // Setup event handlers
      this.setupServerEventHandlers()
      this.setupSignalHandlers()

      // Start the server
      await this.server.start()
    } catch (error) {
      console.error('Failed to start PGLiteSocketServer:', error)
      throw error
    }
  }

  async shutdown(exitCode: number = 0): Promise<void> {
    console.log('\nShutting down PGLiteSocketServer...')

    // Terminate subprocess if running
    if (this.subprocessManager) {
      this.subprocessManager.terminate(this.config.shutdownTimeout)
    }

    // Stop server
    if (this.server) {
      await this.server.stop()
    }

    // Close database
    if (this.db) {
      await this.db.close()
    }

    console.log('Server stopped')
    process.exit(exitCode)
  }
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

  spawn(
    command: string,
    databaseUrl: string,
    includeDatabaseUrl: boolean,
  ): void {
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
      // If subprocess fails to start, shutdown the server
      console.log('Subprocess failed to start, shutting down...')
      this.onExit(1)
    })

    this.childProcess.on('close', (code) => {
      console.log(`Command exited with code ${code}`)
      this.childProcess = null

      // If child process exits with non-zero code, notify parent
      if (code !== null && code !== 0) {
        console.log(
          `Child process failed with exit code ${code}, shutting down...`,
        )
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

// Main execution
async function main() {
  // Show help and exit if requested
  if (args.values.help) {
    console.log(help)
    process.exit(0)
  }

  try {
    const config = PGLiteServerRunner.parseConfig()
    const serverRunner = new PGLiteServerRunner(config)
    await serverRunner.start()
  } catch (error) {
    console.error('Unhandled error:', error)
    process.exit(1)
  }
}

// Run the main function
main()
