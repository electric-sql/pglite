# @electric-sql/pglite-pgaudit

[pgaudit](https://github.com/pgaudit/pgaudit) extension for [PGlite](https://pglite.dev).

## Installation

```bash
npm install @electric-sql/pglite-pgaudit
```

## Usage

```typescript
import { PGlite } from '@electric-sql/pglite'
import { pgaudit } from '@electric-sql/pglite-pgaudit'

const pg = new PGlite({
  extensions: {
    pgaudit,
  },
})

await pg.exec('CREATE EXTENSION IF NOT EXISTS pgaudit;')

```

## License

Apache-2.0