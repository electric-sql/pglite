# @electric-sql/pglite-pg_repack

[pg_repack](https://github.com/pg_repack/pg_repack) extension for [PGlite](https://pglite.dev).

## Installation

```bash
npm install @electric-sql/pglite-pg_repack
```

## Usage

```typescript
import { PGlite } from '@electric-sql/pglite'
import { pg_repack } from '@electric-sql/pglite-pg_repack'

const pg = new PGlite({
  extensions: {
    pg_repack,
  },
})

await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_repack;')

```

## License

Apache-2.0