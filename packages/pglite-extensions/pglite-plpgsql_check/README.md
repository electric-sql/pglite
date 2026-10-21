# @electric-sql/pglite-plpgsql-check

[plpgsql_check](https://github.com/okbob/plpgsql_check) extension for [PGlite](https://pglite.dev).

plpgsql_check is a linter, static code analyzer and profiler for PL/pgSQL. It can detect errors in PL/pgSQL functions - such as references to missing columns or tables, type mismatches and unused variables - without executing them.

## Installation

```bash
npm install @electric-sql/pglite-plpgsql-check
```

## Usage

```typescript
import { PGlite } from '@electric-sql/pglite'
import { plpgsql_check } from '@electric-sql/pglite-plpgsql-check'

const pg = new PGlite({
  extensions: {
    plpgsql_check,
  },
})

await pg.exec('CREATE EXTENSION IF NOT EXISTS plpgsql_check;')

await pg.exec(`
  CREATE TABLE t1(a integer, b integer);

  CREATE OR REPLACE FUNCTION public.my_function()
  RETURNS void
  LANGUAGE plpgsql
  AS $$
  DECLARE
    r record;
  BEGIN
    FOR r IN SELECT * FROM t1 LOOP
      RAISE NOTICE '%', r.missing_column;
    END LOOP;
  END;
  $$;
`)

// Check the function for errors without executing it
const res = await pg.query(`
  SELECT * FROM plpgsql_check_function_tb('public.my_function()');
`)
// [
//   {
//     functionid: 'my_function',
//     lineno: 6,
//     statement: 'RAISE',
//     sqlstate: '42703',
//     message: 'record "r" has no field "missing_column"',
//     level: 'error',
//     ...
//   }
// ]
```

## License

Apache-2.0
