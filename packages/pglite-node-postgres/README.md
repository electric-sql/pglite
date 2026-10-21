# pglite-node-postgres

*** This package is EXPERIMENTAL ***

[PGlite](https://github.com/electric-sql/pglite) adapters for [node-postgres](https://github.com/brianc/node-postgres) clients.

Install with:

```bash
npm install @electric-sql/pglite-node-postgres
```

## `PGlitePgConfig`

This package exports a PGlitePgConfig class that can be passed to a `node-postgres` Pool constructor:

```typescript
  const pglite = await PGlite.create()
  const connConfig = new PGlitePgConfig({pglite})
  const pool = new Pool(connConfig)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      name TEXT
    );
  `)

  await pool.query("INSERT INTO test (name) VALUES ('test');")

  const result = await pool.query('SELECT * from test')
```

### Options

- `pglite`: A PGlite instance.
