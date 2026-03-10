# Apache AGE Extension

[Apache AGE](https://age.apache.org/) (A Graph Extension) brings graph database capabilities to PostgreSQL, allowing you to use the Cypher query language alongside standard SQL.

## Installation

The AGE extension is included with PGlite. To use it:

```typescript
import { PGlite } from '@electric-sql/pglite'
import { age } from '@electric-sql/pglite/age'

const pg = new PGlite({
  extensions: {
    age,
  },
})
```

## Important Notes

### Schema Qualification

All AGE functions are in the `ag_catalog` schema. The extension does not implicitly update the search path for safety. You must either manually set the `search_path` to include `ag_catalog` for your connection, or use fully-qualified names:

```typescript
// Explicit qualification:
await pg.exec("SELECT ag_catalog.create_graph('g');")

// Setting the search path for the session:
await pg.exec('SET search_path = ag_catalog, "$user", public;')
await pg.exec("SELECT create_graph('g');")
```

### Column Definitions

Cypher queries require column definitions in the `as` clause to map the dynamic graph types back to standard PostgreSQL relations:

```typescript
// Single column
SELECT * FROM ag_catalog.cypher('g', $$ RETURN 1 $$) as (v ag_catalog.agtype);

// Multiple columns
SELECT * FROM ag_catalog.cypher('g', $$
  MATCH (n) RETURN n.name, n.age
$$) as (name ag_catalog.agtype, age ag_catalog.agtype);
```

## Limitations

- **File operations**: `load_labels_from_file()` is not available (no filesystem access in WASM)
- **Memory**: Large graphs may hit WebAssembly memory limits
- **Performance**: Graph operations are CPU-intensive; consider pagination for large result sets

## Resources

- [Apache AGE Documentation](https://age.apache.org/age-manual/master/index.html)
- [Cypher Query Language](https://neo4j.com/docs/cypher-manual/current/)
- [AGE GitHub Repository](https://github.com/apache/age)
