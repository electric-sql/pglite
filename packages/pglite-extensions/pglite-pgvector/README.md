# @electric-sql/pglite-pgvector

[pgvector](https://github.com/pgvector/pgvector/) extension for [PGlite](https://pglite.dev).

## Installation

```bash
npm install @electric-sql/pglite-pgvector
```

## Usage

```typescript
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'

const pg = new PGlite({
  extensions: {
    vector,
  },
})

await pg.exec('CREATE EXTENSION IF NOT EXISTS vector;')

```

## License

Apache-2.0