# @electric-sql/pglite-pg_hashids

pg_hashids extension for [PGlite](https://pglite.dev).

## Installation

```bash
npm install @electric-sql/pglite-pg_hashids
```

## Usage

```typescript
import { PGlite } from '@electric-sql/pglite'
import { pg_hashids } from '@electric-sql/pglite-pg_hashids'

const pg = new PGlite({
  extensions: {
    pg_hashids,
  },
})

await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_hashids;')

const res = await pg.exec(`SELECT id_encode(1001);`)
// jNl
```

## License

Apache-2.0