# pglite-socket

A socket implementation for PGlite enabling remote connections. This package is a simple wrapper around the `net` module to allow PGlite to be used as a PostgreSQL server.

There are two main components to this package:

- `PGLiteSocketServer` - A TCP server that allows PostgreSQL clients to connect to a PGlite database instance.
- `PGLiteSocketHandler` - A low-level handler for a single socket connection to PGlite. This class handles the raw protocol communication between a socket and PGlite, and can be used to create a custom server.

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
- `port?: number` - The port to listen on (default: 5432)
- `host?: string` - The host to bind to (default: 127.0.0.1)
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

## License

Apache 2.0
