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

You can then use the syncShapeToTable method to sync a table from Electric:

```ts
const shape = await pg.electric.syncShapeToTable({
  shape: { url: 'http://localhost:3000/v1/shape' },
  table: 'todo',
  primaryKey: ['id'],
})
```
