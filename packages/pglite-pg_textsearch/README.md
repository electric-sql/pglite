# @electric-sql/pglite-pg_textsearch

*** EXPERIMENTAL ***

pg_textsearch extension for [PGlite](https://pglite.dev). This is an experimental release, use at your own risk.

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

// Create a table with geometry columns
await pg.exec(`
  CREATE TABLE cities (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    location GEOMETRY(Point, 4326)
  );
`)

// Insert data
await pg.query(`
  INSERT INTO cities (name, location)
  VALUES ('New York', ST_GeomFromText('POINT(-74.0060 40.7128)', 4326))
`)

// Query with spatial functions
const result = await pg.query(`
  SELECT name, ST_AsText(location) as location
  FROM cities
`)
```

## License

Apache-2.0