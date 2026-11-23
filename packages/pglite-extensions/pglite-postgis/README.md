# @electric-sql/pglite-postgis

*** EXPERIMENTAL ***

PostGIS extension for [PGlite](https://pglite.dev). This is an experimental release, use at your own risk.

## Installation

```bash
npm install @electric-sql/pglite-postgis
```

## Usage

```typescript
import { PGlite } from '@electric-sql/pglite'
import { postgis } from '@electric-sql/pglite-postgis'

const pg = new PGlite({
  extensions: {
    postgis,
  },
})

await pg.exec('CREATE EXTENSION IF NOT EXISTS postgis;')

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

This package contains parts under different licenses
(`Apache-2.0 AND GPL-2.0-or-later`):

- The JavaScript/TypeScript wrapper (`dist/index.*`) is licensed under the
  Apache License 2.0.
- The PostGIS extension bundle (`dist/postgis.tar.gz`) contains
  [PostGIS](https://postgis.net) compiled to WebAssembly, which is licensed under
  the GNU General Public License v2.0 or later.

The full texts of both licenses, together with the PostGIS licensing details
(including the libraries it is built with, such as GEOS, PROJ and GDAL), are
included in the [LICENSE](./LICENSE) file.

If you redistribute `postgis.tar.gz` (for example by bundling it with your
application), you must comply with the terms of the GPL for that part.

### Source code

The PostGIS bundle is built from the following sources:

- [postgres-pglite](https://github.com/electric-sql/postgres-pglite), the
  PostgreSQL fork used by PGlite, which contains the build scripts
  (`build-pglite.sh`, `pglite/build-postgis.sh`, `pglite/other_extensions/Makefile`
  and the builder `pglite/builder/Dockerfile`). It is included as the
  `postgres-pglite` submodule of the [PGlite repository](https://github.com/electric-sql/pglite).
- [PostGIS](https://github.com/postgis/postgis), included as the
  `pglite/other_extensions/postgis` submodule of postgres-pglite.

The exact commits used for a given release are the submodule commits recorded in
the PGlite repository at the corresponding release tag.
