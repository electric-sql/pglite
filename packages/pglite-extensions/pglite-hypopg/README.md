# @electric-sql/pglite-hypopg

[hypopg](https://github.com/hypopg/hypopg) extension for [PGlite](https://pglite.dev).

## Installation

```bash
npm install @electric-sql/pglite-hypopg
```

## Usage

```typescript
import { PGlite } from '@electric-sql/pglite'
import { hypopg } from '@electric-sql/pglite-hypopg'

const pg = new PGlite({
  extensions: {
    hypopg,
  },
})

await pg.exec('CREATE EXTENSION IF NOT EXISTS hypopg;')

```

## License

Apache-2.0