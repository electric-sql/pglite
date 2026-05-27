# @electric-sql/pglite-age

[AGE](https://age.apache.org) extension for [PGlite](https://pglite.dev).

## Installation

```bash
npm install @electric-sql/pglite-age
```

## Usage

```typescript
import { PGlite } from '@electric-sql/pglite'
import { age } from '@electric-sql/pglite-age'

const pg = new PGlite({
  extensions: {
    age,
  },
})

await pg.exec('CREATE EXTENSION IF NOT EXISTS age;')

// Create a new graph using ag_catalog.create_graph()
// This creates the graph metadata and necessary internal tables
await pg.exec("SELECT ag_catalog.create_graph('test_graph');")

```

## License

Apache-2.0