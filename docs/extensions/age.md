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

## Quick Start

### Create a Graph

```typescript
// Create a new graph
await pg.exec("SELECT ag_catalog.create_graph('my_graph');")
```

### Create Nodes

```typescript
// Create a node with a label and properties
await pg.exec(`
  SELECT * FROM ag_catalog.cypher('my_graph', $$
    CREATE (n:Person {name: 'Alice', age: 30})
    RETURN n
  $$) as (v ag_catalog.agtype);
`)
```

### Create Relationships

```typescript
// Create nodes and a relationship between them
await pg.exec(`
  SELECT * FROM ag_catalog.cypher('my_graph', $$
    CREATE (a:Person {name: 'Alice'})-[:KNOWS {since: 2020}]->(b:Person {name: 'Bob'})
    RETURN a, b
  $$) as (a ag_catalog.agtype, b ag_catalog.agtype);
`)
```

### Query Data

```typescript
// Find all people Alice knows
const result = await pg.query(`
  SELECT * FROM ag_catalog.cypher('my_graph', $$
    MATCH (a:Person {name: 'Alice'})-[:KNOWS]->(friend:Person)
    RETURN friend.name, friend.age
  $$) as (name ag_catalog.agtype, age ag_catalog.agtype);
`)

console.log(result.rows)
// [{ name: '"Bob"', age: '25' }]
```

### Update Properties

```typescript
await pg.exec(`
  SELECT * FROM ag_catalog.cypher('my_graph', $$
    MATCH (n:Person {name: 'Alice'})
    SET n.city = 'New York', n.age = 31
    RETURN n
  $$) as (v ag_catalog.agtype);
`)
```

### Delete Nodes

```typescript
await pg.exec(`
  SELECT * FROM ag_catalog.cypher('my_graph', $$
    MATCH (n:Person {name: 'Bob'})
    DETACH DELETE n
  $$) as (v ag_catalog.agtype);
`)
```

### Drop a Graph

```typescript
await pg.exec("SELECT ag_catalog.drop_graph('my_graph', true);")
```

## Complete Example: Social Network

```typescript
import { PGlite } from '@electric-sql/pglite'
import { age } from '@electric-sql/pglite/age'

async function main() {
  const pg = new PGlite({ extensions: { age } })

  // Create graph
  await pg.exec("SELECT ag_catalog.create_graph('social');")

  // Create users
  await pg.exec(`
    SELECT * FROM ag_catalog.cypher('social', $$
      CREATE 
        (alice:User {name: 'Alice', email: 'alice@example.com'}),
        (bob:User {name: 'Bob', email: 'bob@example.com'}),
        (charlie:User {name: 'Charlie', email: 'charlie@example.com'})
    $$) as (v ag_catalog.agtype);
  `)

  // Create friendships
  await pg.exec(`
    SELECT * FROM ag_catalog.cypher('social', $$
      MATCH (a:User {name: 'Alice'}), (b:User {name: 'Bob'})
      CREATE (a)-[:FRIENDS_WITH]->(b)
    $$) as (v ag_catalog.agtype);
  `)

  await pg.exec(`
    SELECT * FROM ag_catalog.cypher('social', $$
      MATCH (b:User {name: 'Bob'}), (c:User {name: 'Charlie'})
      CREATE (b)-[:FRIENDS_WITH]->(c)
    $$) as (v ag_catalog.agtype);
  `)

  // Find friends of friends
  const result = await pg.query(`
    SELECT * FROM ag_catalog.cypher('social', $$
      MATCH (alice:User {name: 'Alice'})-[:FRIENDS_WITH*1..2]->(person:User)
      RETURN DISTINCT person.name
    $$) as (name ag_catalog.agtype);
  `)

  console.log('Friends and friends-of-friends:', result.rows)
  // [{ name: '"Bob"' }, { name: '"Charlie"' }]

  await pg.close()
}

main()
```

## Cypher Query Syntax

AGE supports a subset of the Cypher query language. Key clauses include:

| Clause | Description | Example |
|--------|-------------|---------|
| `CREATE` | Create nodes and relationships | `CREATE (n:Label {prop: 'value'})` |
| `MATCH` | Find patterns in the graph | `MATCH (n:Label) RETURN n` |
| `WHERE` | Filter results | `WHERE n.age > 25` |
| `RETURN` | Specify what to return | `RETURN n.name, n.age` |
| `SET` | Update properties | `SET n.prop = 'new value'` |
| `DELETE` | Remove nodes/relationships | `DELETE n` or `DETACH DELETE n` |
| `ORDER BY` | Sort results | `ORDER BY n.name DESC` |
| `LIMIT` | Limit result count | `LIMIT 10` |

## Data Types

AGE returns data as `agtype`, a JSON-like format:

```typescript
// Vertex (node)
{id: 123, label: 'Person', properties: {name: 'Alice'}}::vertex

// Edge (relationship)  
{id: 456, startid: 123, endid: 789, label: 'KNOWS', properties: {}}::edge

// Scalar values are JSON-encoded
'"Alice"'  // string
'30'       // number
'true'     // boolean
```

## Important Notes

### Schema Qualification

All AGE functions are in the `ag_catalog` schema. The extension automatically sets `search_path` to include `ag_catalog`, but you can also use fully-qualified names:

```typescript
// Both work:
await pg.exec("SELECT create_graph('g');")  // search_path includes ag_catalog
await pg.exec("SELECT ag_catalog.create_graph('g');")  // explicit
```

### Column Definitions

Cypher queries require column definitions in the `as` clause:

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

