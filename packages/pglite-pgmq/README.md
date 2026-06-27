# @electric-sql/pglite-pgmq

[pgmq](https://github.com/pgmq/pgmq) extension for [PGlite](https://pglite.dev).

## Installation

```bash
npm install @electric-sql/pglite-pgmq
```

## Usage

```typescript
import { PGlite } from '@electric-sql/pglite'
import { pgmq } from '@electric-sql/pglite-pgmq'

const pg = new PGlite({
  extensions: {
    pgmq,
  },
})

await pg.exec('CREATE EXTENSION IF NOT EXISTS pgmq;')

// create a queue
await pg.exec(`SELECT pgmq.create('my_queue'`);

// send a message as JSON
await pg.exec(`SELECT * from pgmq.send(
  queue_name  => 'my_queue',
  msg         => '{"foo": "bar1"}'
);`)

// read a message
const msg = await pg.exec(`SELECT * FROM pgmq.read(
  queue_name => 'my_queue',
  vt         => 30,
  qty        => 2
);`)

```

## License

Apache-2.0