# @electric-sql/pglite-pgtap

[pgTAP](https://pgtap.org) extension for [PGlite](https://pglite.dev).

## Installation

```bash
npm install @electric-sql/pglite-pgtap
```

## Usage

```typescript
import { PGlite } from '@electric-sql/pglite'
import { pgtap } from '@electric-sql/pglite-pgtap'

const pg = new PGlite({
  extensions: {
    pgtap,
  },
})

await pg.exec('CREATE EXTENSION IF NOT EXISTS pgtap;')

```

## License

Apache-2.0