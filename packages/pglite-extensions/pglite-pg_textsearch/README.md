# @electric-sql/pglite-pg_textsearch

pg_textsearch extension for [PGlite](https://pglite.dev).

## Installation

```bash
npm install @electric-sql/pglite-pg_textsearch
```

## Usage

```typescript
import { PGlite } from '@electric-sql/pglite'
import { pg_textsearch } from '@electric-sql/pglite-pg_textsearch'

const pg = new PGlite({
  extensions: {
    pg_textsearch,
  },
})

await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_textsearch;')

```

## License

Apache-2.0