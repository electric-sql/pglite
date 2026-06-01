# @electric-sql/pglite-pg_ivm

[pg_ivm](https://github.com/sraoss/pg_ivm) extension for [PGlite](https://pglite.dev).

## Installation

```bash
npm install @electric-sql/pglite-pg_ivm
```

## Usage

```typescript
import { PGlite } from '@electric-sql/pglite'
import { pg_ivm } from '@electric-sql/pglite-pg_ivm'

const pg = new PGlite({
  extensions: {
    pg_ivm,
  },
})

await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_ivm;')

// Create base table
await pg.exec(`
  CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER,
    amount DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT NOW()
  );
`)

// Create incremental materialized view using correct syntax with dollar quoting
await pg.exec(`
  SELECT pgivm.create_immv('order_summary', $$
    SELECT 
      customer_id,
      COUNT(*) as order_count,
      SUM(amount) as total_amount
    FROM orders 
    GROUP BY customer_id
  $$);
`)

// Commit to ensure view is created
await pg.exec('COMMIT;')
// Verify the view was created - check both pg_matviews and information_schema
const res = await pg.query<{ table_name: string }>(`
  SELECT table_name 
  FROM information_schema.tables 
  WHERE table_name = 'order_summary' AND table_type = 'BASE TABLE'
`)

```

## License

Apache-2.0