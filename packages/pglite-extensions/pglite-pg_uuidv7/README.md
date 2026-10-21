# @electric-sql/pglite-pg_uuidv7

[pg_uuidv7](https://github.com/fboulnois/pg_uuidv7) extension for [PGlite](https://pglite.dev).

## Installation

```bash
npm install @electric-sql/pglite-pg_uuidv7
```

## Usage

```typescript
import { PGlite } from '@electric-sql/pglite'
import { pg_uuidv7 } from '@electric-sql/pglite-pg_uuidv7'

const pg = new PGlite({
  extensions: {
    pg_uuidv7,
  },
})

await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_uuidv7;')

```

## License

Apache-2.0