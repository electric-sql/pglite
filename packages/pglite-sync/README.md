# PGlite ElectricSQL Sync Plugin

A [sync plugin](https://pglite.dev/docs/sync) for [PGlite](https://pglite.dev/) using [ElectricSQL](https://electric-sql.com/). Full documentation is available at [pglite.dev/docs/sync](https://pglite.dev/docs/sync).

To install:

```sh
npm install @electric-sql/pglite-sync
```

Then add it to you PGlite instance and create any local tables needed:

```ts
import { electricSync } from '@electric-sql/pglite-sync'

const pg = await PGlite.create({
  extensions: {
    electric: electricSync(),
  },
})

await pg.exec(`
  CREATE TABLE IF NOT EXISTS todo (
    id SERIAL PRIMARY KEY,
    task TEXT,
    done BOOLEAN
  );
`)
```

You can sync data from Electric using either the single table or multi-table API:

### Single Table Sync

Use `syncShapeToTable` to sync a single table:

```ts
const shape = await pg.electric.syncShapeToTable({
  shape: { url: 'http://localhost:3000/v1/shape', table: 'todo' },
  shapeKey: 'todo', // or null if the shape state does not need to be persisted
  table: 'todo',
  primaryKey: ['id'],
  onError: (error) => {
    console.error('Shape sync error', error)
  }
})
```

### Multi-Table Sync

The multi-table API is useful when you need to sync related tables together, ensuring consistency across multiple tables by syncing updates that happened in as single transaction in Postgres within a single transaction in PGLite.

Use `syncShapesToTables` to sync multiple tables simultaneously:

```ts
const sync = await pg.electric.syncShapesToTables({
  shapes: {
    todos: {
      shape: { url: 'http://localhost:3000/v1/shape', table: 'todo' },
      table: 'todo',
      primaryKey: ['id'],
    },
    users: {
      shape: { url: 'http://localhost:3000/v1/shape', table: 'users' },
      table: 'users',
      primaryKey: ['id'],
    }
  },
  key: 'my-sync', // or null if the sync state does not need to be persisted
  onInitialSync: () => {
    console.log('Initial sync complete')
  },
  onError: (error) => {
    console.error('Sync error', error)
  }
})

// Unsubscribe when done
sync.unsubscribe()
```
