# pglite-socket

A socket implementation for PGlite enabling remote connections. This package is a simple wrapper around the `net` module to allow PGlite to be used as a PostgreSQL server.

There are two main components to this package:

- [`PGLiteSocketServer`](#pglitesocketserver) - A TCP server that allows PostgreSQL clients to connect to a PGlite database instance.
- [`PGLiteSocketHandler`](#pglitesockethandler) - A low-level handler for a single socket connection to PGlite. This class handles the raw protocol communication between a socket and PGlite, and can be used to create a custom server.

The package also includes a [CLI](#cli-usage) for quickly starting a PGlite socket server.

Note: As PGlite is a single-connection database, it is not possible to have multiple simultaneous connections open. This means that the socket server will only support a single client connection at a time. While a `PGLiteSocketServer` or `PGLiteSocketHandler` are attached to a PGlite instance they hold an exclusive lock preventing any other connections, or queries on the PGlite instance.

## Installation

```bash
npm install @electric-sql/pglite-socket
# or
yarn add @electric-sql/pglite-socket
# or
pnpm add @electric-sql/pglite-socket
```

## Usage

```typescript
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

// Create a PGlite instance
const db = await PGlite.create()

// Create and start a socket server
const server = new PGLiteSocketServer({
  db,
  port: 5432,
  host: '127.0.0.1',
})

await server.start()
console.log('Server started on 127.0.0.1:5432')

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await server.stop()
  await db.close()
  console.log('Server stopped and database closed')
  process.exit(0)
})
```

## API

### PGLiteSocketServer

Creates a TCP server that allows PostgreSQL clients to connect to a PGlite database instance.

#### Options

- `db: PGlite` - The PGlite database instance
- `port?: number` - The port to listen on (default: 5432). Use port 0 to let the OS assign an available port
- `host?: string` - The host to bind to (default: 127.0.0.1)
- `path?: string` - Unix socket path to bind to (takes precedence over host:port)
- `inspect?: boolean` - Print the incoming and outgoing data to the console (default: false)

#### Methods

- `start(): Promise<void>` - Start the socket server
- `stop(): Promise<void>` - Stop the socket server

#### Events

- `listening` - Emitted when the server starts listening
- `connection` - Emitted when a client connects
- `error` - Emitted when an error occurs
- `close` - Emitted when the server is closed

### PGLiteSocketHandler

Low-level handler for a single socket connection to PGlite. This class handles the raw protocol communication between a socket and PGlite.

#### Options

- `db: PGlite` - The PGlite database instance
- `closeOnDetach?: boolean` - Whether to close the socket when detached (default: false)
- `inspect?: boolean` - Print the incoming and outgoing data to the console in hex and ascii (default: false)

#### Methods

- `attach(socket: Socket): Promise<PGLiteSocketHandler>` - Attach a socket to this handler
- `detach(close?: boolean): PGLiteSocketHandler` - Detach the current socket from this handler
- `isAttached: boolean` - Check if a socket is currently attached

#### Events

- `data` - Emitted when data is processed through the handler
- `error` - Emitted when an error occurs
- `close` - Emitted when the socket is closed

#### Example

```typescript
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketHandler } from '@electric-sql/pglite-socket'
import { createServer, Socket } from 'net'

// Create a PGlite instance
const db = await PGlite.create()

// Create a handler
const handler = new PGLiteSocketHandler({
  db,
  closeOnDetach: true,
  inspect: false,
})

// Create a server that uses the handler
const server = createServer(async (socket: Socket) => {
  try {
    await handler.attach(socket)
    console.log('Client connected')
  } catch (err) {
    console.error('Error attaching socket', err)
    socket.end()
  }
})

server.listen(5432, '127.0.0.1')
```

## Examples

See the [examples directory](./examples) for more usage examples.

## CLI Usage

This package provides a command-line interface for quickly starting a PGlite socket server.

```bash
# Install globally
npm install -g @electric-sql/pglite-socket

# Start a server with default settings (in-memory database, port 5432)
pglite-server

# Start a server with custom options
pglite-server --db=/path/to/database --port=5433 --host=0.0.0.0 --debug=1

# Using short options
pglite-server -d /path/to/database -p 5433 -h 0.0.0.0 -v 1

# Show help
pglite-server --help
```

### CLI Options

- `-d, --db=PATH` - Database path (default: memory://)
- `-p, --port=PORT` - Port to listen on (default: 5432). Use 0 to let the OS assign an available port
- `-h, --host=HOST` - Host to bind to (default: 127.0.0.1)
- `-u, --path=UNIX` - Unix socket to bind to (takes precedence over host:port)
- `-v, --debug=LEVEL` - Debug level 0-5 (default: 0)
- `-e, --extensions=LIST` - Comma-separated list of extensions to load (e.g., vector,pgcrypto)
- `-r, --run=COMMAND` - Command to run after server starts
- `--include-database-url` - Include DATABASE_URL in subprocess environment
- `--shutdown-timeout=MS` - Timeout for graceful subprocess shutdown in ms (default: 5000)

### Development Server Integration

The `--run` option is particularly useful for development workflows where you want to use PGlite as a drop-in replacement for PostgreSQL. This allows you to wrap your development server and automatically provide it with a DATABASE_URL pointing to your PGlite instance.

```bash
# Start your Next.js dev server with PGlite
pglite-server --run "npm run dev" --include-database-url

# Start a Node.js app with PGlite
pglite-server --db=./dev-db --run "node server.js" --include-database-url

# Start multiple services (using a process manager like concurrently)
pglite-server --run "npx concurrently 'npm run dev' 'npm run worker'" --include-database-url
```

When using `--run` with `--include-database-url`, the subprocess will receive a `DATABASE_URL` environment variable with the correct connection string for your PGlite server. This enables seamless integration with applications that expect a PostgreSQL connection string.

### Using in npm scripts

You can add the CLI to your package.json scripts for convenient execution:

```json
{
  "scripts": {
    "db:start": "pglite-server --db=./data/mydb --port=5433",
    "db:dev": "pglite-server --db=memory:// --debug=1",
    "dev": "pglite-server --db=./dev-db --run 'npm run start:dev' --include-database-url",
    "dev:clean": "pglite-server --run 'npm run start:dev' --include-database-url"
  }
}
```

Then run with:

```bash
npm run dev          # Start with persistent database
npm run dev:clean    # Start with in-memory database
```

### Unix Socket Support

For better performance in local development, you can use Unix sockets instead of TCP:

```bash
# Start server on a Unix socket
pglite-server --path=/tmp/pglite.sock --run "npm run dev" --include-database-url

# The DATABASE_URL will be: postgresql://postgres:postgres@/postgres?host=/tmp
```

### Connecting to the server

Once the server is running, you can connect to it using any PostgreSQL client:

#### Using psql

```bash
PGSSLMODE=disable psql -h localhost -p 5432 -d template1
```

#### Using Node.js clients

```javascript
// Using node-postgres
import pg from 'pg'
const client = new pg.Client({
  host: 'localhost',
  port: 5432,
  database: 'template1'
})
await client.connect()

// Using postgres.js
import postgres from 'postgres'
const sql = postgres({
  host: 'localhost',
  port: 5432,
  database: 'template1'
})

// Using environment variable (when using --include-database-url)
const sql = postgres(process.env.DATABASE_URL)
```

### Limitations and Tips

- Remember that PGlite only supports one connection at a time. If you're unable to connect, make sure no other client is currently connected.
- For development purposes, using an in-memory database (`--db=memory://`) is fastest but data won't persist after the server is stopped.
- For persistent storage, specify a file path for the database (e.g., `--db=./data/mydb`).
- When using debug mode (`--debug=1` or higher), additional protocol information will be displayed in the console.
- To allow connections from other machines, set the host to `0.0.0.0` with `--host=0.0.0.0`.
- SSL connections are **NOT** supported. For `psql`, set env var `PGSSLMODE=disable`.
- When using `--run`, the server will automatically shut down if the subprocess exits with a non-zero code.
- Use `--shutdown-timeout` to adjust how long to wait for graceful subprocess termination (default: 5 seconds).

## License

Apache 2.0
