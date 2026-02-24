/**
 * AGE Extension Tests for PGlite
 *
 * Apache AGE (A Graph Extension) brings graph database functionality to PostgreSQL.
 * This test suite demonstrates common graph operations using Cypher query language.
 *
 * @see https://age.apache.org/ - Apache AGE documentation
 * @see https://pglite.dev/ - PGlite documentation
 *
 * Usage:
 * ```typescript
 * import { PGlite } from '@electric-sql/pglite'
 * import { age } from '@electric-sql/pglite/age'
 *
 * const pg = new PGlite({ extensions: { age } })
 * ```
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { testEsmCjsAndDTC } from './test-utils.ts'

await testEsmCjsAndDTC(async (importType) => {
  const { PGlite } =
    importType === 'esm'
      ? await import('../dist/index.js')
      : ((await import(
          '../dist/index.cjs'
        )) as unknown as typeof import('../dist/index.js'))

  const { age } =
    importType === 'esm'
      ? await import('../dist/age/index.js')
      : ((await import(
          '../dist/age/index.cjs'
        )) as unknown as typeof import('../dist/age/index.js'))

  describe(`age (${importType})`, () => {
    // =========================================================================
    // BASIC EXTENSION LOADING
    // =========================================================================

    it('can load extension', async () => {
      const pg = new PGlite({
        extensions: {
          age,
        },
      })

      const res = await pg.query<{ extname: string }>(`
        SELECT extname FROM pg_extension WHERE extname = 'age'
      `)

      expect(res.rows).toHaveLength(1)
      expect(res.rows[0].extname).toBe('age')
      await pg.close()
    })

    // =========================================================================
    // GRAPH LIFECYCLE - CREATE AND DROP GRAPHS
    // =========================================================================

    it('can create a graph', async () => {
      const pg = new PGlite({
        extensions: {
          age,
        },
      })

      // Create a new graph using ag_catalog.create_graph()
      // This creates the graph metadata and necessary internal tables
      await pg.exec("SELECT ag_catalog.create_graph('test_graph');")

      // Verify graph exists in ag_catalog.ag_graph system table
      const res = await pg.query<{ name: string }>(`
        SELECT name FROM ag_catalog.ag_graph WHERE name = 'test_graph'
      `)

      expect(res.rows).toHaveLength(1)
      expect(res.rows[0].name).toBe('test_graph')
      await pg.close()
    })

    it('can drop graph', async () => {
      const pg = new PGlite({
        extensions: {
          age,
        },
      })

      // Create and then drop a graph
      await pg.exec("SELECT ag_catalog.create_graph('temp_graph');")
      await pg.exec("SELECT ag_catalog.drop_graph('temp_graph', true);")

      // Verify graph no longer exists
      const res = await pg.query<{ name: string }>(`
        SELECT name FROM ag_catalog.ag_graph WHERE name = 'temp_graph'
      `)

      expect(res.rows).toHaveLength(0)
      await pg.close()
    })

    // =========================================================================
    // CREATING NODES (VERTICES)
    // =========================================================================

    it('can execute cypher CREATE and MATCH', async () => {
      const pg = new PGlite({
        extensions: {
          age,
        },
      })

      await pg.exec("SELECT ag_catalog.create_graph('cypher_test');")

      // CREATE a node with a label and properties
      // Labels are like types/categories for nodes (e.g., Person, Movie)
      // Properties are key-value pairs stored on the node
      await pg.exec(`
        SELECT * FROM ag_catalog.cypher('cypher_test', $$
          CREATE (n:Person {name: 'Alice', age: 30})
          RETURN n
        $$) as (v ag_catalog.agtype);
      `)

      // MATCH finds nodes that match the pattern
      // Properties in the pattern act as filters
      const res = await pg.query<{ v: string }>(`
        SELECT * FROM ag_catalog.cypher('cypher_test', $$
          MATCH (n:Person {name: 'Alice'})
          RETURN n
        $$) as (v ag_catalog.agtype);
      `)

      expect(res.rows).toHaveLength(1)
      // AGE returns data as agtype (JSON-like format)
      expect(res.rows[0].v).toContain('Alice')
      await pg.close()
    })

    // =========================================================================
    // CREATING RELATIONSHIPS (EDGES)
    // =========================================================================

    it('can create edges between nodes', async () => {
      const pg = new PGlite({
        extensions: {
          age,
        },
      })

      await pg.exec("SELECT ag_catalog.create_graph('edge_test');")

      // Create a full path: two nodes connected by an edge
      // Pattern: (node1)-[:EDGE_TYPE]->(node2)
      // Edges are directed (arrow shows direction)
      await pg.exec(`
        SELECT * FROM ag_catalog.cypher('edge_test', $$
          CREATE (a:Person {name: 'Alice'})-[:KNOWS {since: 2020}]->(b:Person {name: 'Bob'})
          RETURN a, b
        $$) as (a ag_catalog.agtype, b ag_catalog.agtype);
      `)

      // Query the relationship
      // MATCH pattern includes the edge with its type
      const res = await pg.query<{ name: string; friend: string }>(`
        SELECT * FROM ag_catalog.cypher('edge_test', $$
          MATCH (a:Person)-[:KNOWS]->(b:Person)
          RETURN a.name, b.name
        $$) as (name ag_catalog.agtype, friend ag_catalog.agtype);
      `)

      expect(res.rows).toHaveLength(1)
      expect(res.rows[0].name).toBe('"Alice"')
      expect(res.rows[0].friend).toBe('"Bob"')
      await pg.close()
    })

    // =========================================================================
    // CYPHER PARSER HOOKS - VERIFYING AGE INTEGRATION
    // =========================================================================

    it('hooks are active - cypher syntax parses correctly', async () => {
      const pg = new PGlite({
        extensions: {
          age,
        },
      })

      await pg.exec("SELECT ag_catalog.create_graph('hook_test');")

      // This query uses Cypher-specific syntax that PostgreSQL
      // doesn't understand natively. It only works because AGE's
      // post_parse_analyze_hook intercepts and transforms the query.
      const res = await pg.query<{ result: string }>(`
        SELECT * FROM ag_catalog.cypher('hook_test', $$
          RETURN 1 + 2
        $$) as (result ag_catalog.agtype);
      `)

      expect(res.rows).toHaveLength(1)
      expect(res.rows[0].result).toBe('3')
      await pg.close()
    })

    // =========================================================================
    // FILTERING WITH WHERE CLAUSE
    // =========================================================================

    it('can use WHERE clause in MATCH', async () => {
      const pg = new PGlite({
        extensions: {
          age,
        },
      })

      await pg.exec("SELECT ag_catalog.create_graph('where_test');")

      // Create multiple nodes
      await pg.exec(`
        SELECT * FROM ag_catalog.cypher('where_test', $$
          CREATE (:Person {name: 'Alice', age: 30}),
                 (:Person {name: 'Bob', age: 25}),
                 (:Person {name: 'Charlie', age: 35})
        $$) as (v ag_catalog.agtype);
      `)

      // Use WHERE to filter results
      // WHERE clause supports comparison operators and boolean logic
      const res = await pg.query<{ name: string }>(`
        SELECT * FROM ag_catalog.cypher('where_test', $$
          MATCH (p:Person)
          WHERE p.age > 28
          RETURN p.name
        $$) as (name ag_catalog.agtype);
      `)

      expect(res.rows).toHaveLength(2)
      const names = res.rows.map((r) => r.name)
      expect(names).toContain('"Alice"')
      expect(names).toContain('"Charlie"')
      await pg.close()
    })

    // =========================================================================
    // QUERY ANALYSIS WITH EXPLAIN
    // =========================================================================

    it('EXPLAIN works on cypher queries', async () => {
      const pg = new PGlite({
        extensions: {
          age,
        },
      })

      await pg.exec("SELECT ag_catalog.create_graph('explain_test');")

      // EXPLAIN shows the query execution plan
      // Useful for performance tuning
      const res = await pg.query<{ 'QUERY PLAN': string }>(`
        EXPLAIN SELECT * FROM ag_catalog.cypher('explain_test', $$
          MATCH (n)
          RETURN n
        $$) as (v ag_catalog.agtype);
      `)

      expect(res.rows.length).toBeGreaterThan(0)
      await pg.close()
    })

    // =========================================================================
    // UNICODE AND INTERNATIONAL TEXT SUPPORT
    // =========================================================================

    it('handles unicode in properties', async () => {
      const pg = new PGlite({
        extensions: {
          age,
        },
      })

      await pg.exec("SELECT ag_catalog.create_graph('unicode_test');")

      // Create node with unicode properties
      // AGE supports full UTF-8 text in property values
      await pg.exec(`
        SELECT * FROM ag_catalog.cypher('unicode_test', $$
          CREATE (n:Message {
            text: '你好世界',
            emoji: '🎉',
            mixed: 'Hello 世界! 🌍'
          })
        $$) as (v ag_catalog.agtype);
      `)

      const res = await pg.query<{ text: string }>(`
        SELECT * FROM ag_catalog.cypher('unicode_test', $$
          MATCH (n:Message)
          RETURN n.text
        $$) as (text ag_catalog.agtype);
      `)

      expect(res.rows).toHaveLength(1)
      expect(res.rows[0].text).toContain('你好世界')
      await pg.close()
    })

    // =========================================================================
    // ERROR HANDLING
    // =========================================================================

    it('handles invalid cypher syntax gracefully', async () => {
      const pg = new PGlite({
        extensions: {
          age,
        },
      })

      await pg.exec("SELECT ag_catalog.create_graph('error_test');")

      // Invalid Cypher syntax should throw an error
      await expect(
        pg.exec(`
          SELECT * FROM ag_catalog.cypher('error_test', $$
            MATCH (n INVALID SYNTAX
          $$) as (v ag_catalog.agtype);
        `),
      ).rejects.toThrow()

      await pg.close()
    })

    // =========================================================================
    // UPDATING NODE PROPERTIES
    // =========================================================================

    it('can update node properties', async () => {
      const pg = new PGlite({
        extensions: {
          age,
        },
      })

      await pg.exec("SELECT ag_catalog.create_graph('update_test');")

      // Create a node
      await pg.exec(`
        SELECT * FROM ag_catalog.cypher('update_test', $$
          CREATE (n:Person {name: 'Alice', age: 30})
        $$) as (v ag_catalog.agtype);
      `)

      // Update the node using SET clause
      await pg.exec(`
        SELECT * FROM ag_catalog.cypher('update_test', $$
          MATCH (n:Person {name: 'Alice'})
          SET n.age = 31, n.city = 'New York'
          RETURN n
        $$) as (v ag_catalog.agtype);
      `)

      // Verify the update
      const res = await pg.query<{ age: string; city: string }>(`
        SELECT * FROM ag_catalog.cypher('update_test', $$
          MATCH (n:Person {name: 'Alice'})
          RETURN n.age, n.city
        $$) as (age ag_catalog.agtype, city ag_catalog.agtype);
      `)

      expect(res.rows).toHaveLength(1)
      expect(res.rows[0].age).toBe('31')
      expect(res.rows[0].city).toBe('"New York"')
      await pg.close()
    })

    // =========================================================================
    // DELETING NODES
    // =========================================================================

    it('can delete nodes', async () => {
      const pg = new PGlite({
        extensions: {
          age,
        },
      })

      await pg.exec("SELECT ag_catalog.create_graph('delete_test');")

      // Create nodes
      await pg.exec(`
        SELECT * FROM ag_catalog.cypher('delete_test', $$
          CREATE (:Person {name: 'ToDelete'}),
                 (:Person {name: 'ToKeep'})
        $$) as (v ag_catalog.agtype);
      `)

      // Delete specific node using DELETE clause
      // DETACH DELETE removes the node and all its relationships
      await pg.exec(`
        SELECT * FROM ag_catalog.cypher('delete_test', $$
          MATCH (n:Person {name: 'ToDelete'})
          DELETE n
        $$) as (v ag_catalog.agtype);
      `)

      // Verify only one node remains
      const res = await pg.query<{ count: string }>(`
        SELECT * FROM ag_catalog.cypher('delete_test', $$
          MATCH (n:Person)
          RETURN count(n)
        $$) as (count ag_catalog.agtype);
      `)

      expect(res.rows[0].count).toBe('1')
      await pg.close()
    })

    // =========================================================================
    // ORDERING AND LIMITING RESULTS
    // =========================================================================

    it('can use ORDER BY and LIMIT', async () => {
      const pg = new PGlite({
        extensions: {
          age,
        },
      })

      await pg.exec("SELECT ag_catalog.create_graph('order_test');")

      // Create multiple nodes with different ages
      await pg.exec(`
        SELECT * FROM ag_catalog.cypher('order_test', $$
          CREATE (:Person {name: 'Alice', age: 30}),
                 (:Person {name: 'Bob', age: 25}),
                 (:Person {name: 'Charlie', age: 35}),
                 (:Person {name: 'Diana', age: 28})
        $$) as (v ag_catalog.agtype);
      `)

      // Query with ORDER BY and LIMIT
      // ORDER BY sorts results, LIMIT restricts count
      const res = await pg.query<{ name: string }>(`
        SELECT * FROM ag_catalog.cypher('order_test', $$
          MATCH (p:Person)
          RETURN p.name
          ORDER BY p.age DESC
          LIMIT 2
        $$) as (name ag_catalog.agtype);
      `)

      expect(res.rows).toHaveLength(2)
      expect(res.rows[0].name).toBe('"Charlie"') // age 35
      expect(res.rows[1].name).toBe('"Alice"') // age 30
      await pg.close()
    })

    // =========================================================================
    // REAL-WORLD EXAMPLE: SOCIAL NETWORK
    // =========================================================================

    describe('real-world example: social network', () => {
      let pg: InstanceType<typeof PGlite>

      beforeAll(async () => {
        pg = new PGlite({
          extensions: { age },
        })

        // Create a social network graph
        await pg.exec("SELECT ag_catalog.create_graph('social');")

        // Create users
        await pg.exec(`
          SELECT * FROM ag_catalog.cypher('social', $$
            CREATE 
              (alice:User {name: 'Alice', email: 'alice@example.com', joined: '2023-01-15'}),
              (bob:User {name: 'Bob', email: 'bob@example.com', joined: '2023-02-20'}),
              (charlie:User {name: 'Charlie', email: 'charlie@example.com', joined: '2023-03-10'}),
              (diana:User {name: 'Diana', email: 'diana@example.com', joined: '2023-04-05'})
          $$) as (v ag_catalog.agtype);
        `)

        // Create friendship relationships
        await pg.exec(`
          SELECT * FROM ag_catalog.cypher('social', $$
            MATCH (alice:User {name: 'Alice'}), (bob:User {name: 'Bob'})
            CREATE (alice)-[:FRIENDS_WITH {since: '2023-03-01'}]->(bob)
          $$) as (v ag_catalog.agtype);
        `)

        await pg.exec(`
          SELECT * FROM ag_catalog.cypher('social', $$
            MATCH (alice:User {name: 'Alice'}), (charlie:User {name: 'Charlie'})
            CREATE (alice)-[:FRIENDS_WITH {since: '2023-04-15'}]->(charlie)
          $$) as (v ag_catalog.agtype);
        `)

        await pg.exec(`
          SELECT * FROM ag_catalog.cypher('social', $$
            MATCH (bob:User {name: 'Bob'}), (diana:User {name: 'Diana'})
            CREATE (bob)-[:FRIENDS_WITH {since: '2023-05-01'}]->(diana)
          $$) as (v ag_catalog.agtype);
        `)

        // Create posts
        await pg.exec(`
          SELECT * FROM ag_catalog.cypher('social', $$
            MATCH (alice:User {name: 'Alice'})
            CREATE (alice)-[:POSTED]->(p:Post {
              content: 'Hello from PGlite with AGE!',
              timestamp: '2023-06-01T10:00:00Z',
              likes: 42
            })
          $$) as (v ag_catalog.agtype);
        `)
      })

      afterAll(async () => {
        await pg.close()
      })

      it('can find direct friends', async () => {
        const res = await pg.query<{ friend: string }>(`
          SELECT * FROM ag_catalog.cypher('social', $$
            MATCH (alice:User {name: 'Alice'})-[:FRIENDS_WITH]->(friend:User)
            RETURN friend.name
          $$) as (friend ag_catalog.agtype);
        `)

        expect(res.rows).toHaveLength(2)
        const friends = res.rows.map((r) => r.friend)
        expect(friends).toContain('"Bob"')
        expect(friends).toContain('"Charlie"')
      })

      it('can find friends of friends', async () => {
        // Variable length path: find friends up to 2 hops away
        const res = await pg.query<{ person: string }>(`
          SELECT * FROM ag_catalog.cypher('social', $$
            MATCH (alice:User {name: 'Alice'})-[:FRIENDS_WITH*1..2]->(person:User)
            WHERE person.name <> 'Alice'
            RETURN DISTINCT person.name
          $$) as (person ag_catalog.agtype);
        `)

        // Should find Bob, Charlie (direct) and Diana (through Bob)
        expect(res.rows.length).toBeGreaterThanOrEqual(2)
        const people = res.rows.map((r) => r.person)
        expect(people).toContain('"Diana"') // friend of friend
      })

      it('can find posts by user', async () => {
        const res = await pg.query<{ content: string; likes: string }>(`
          SELECT * FROM ag_catalog.cypher('social', $$
            MATCH (u:User {name: 'Alice'})-[:POSTED]->(post:Post)
            RETURN post.content, post.likes
          $$) as (content ag_catalog.agtype, likes ag_catalog.agtype);
        `)

        expect(res.rows).toHaveLength(1)
        expect(res.rows[0].content).toContain('PGlite with AGE')
        expect(res.rows[0].likes).toBe('42')
      })

      it('can count relationships', async () => {
        const res = await pg.query<{ name: string; friend_count: string }>(`
          SELECT * FROM ag_catalog.cypher('social', $$
            MATCH (u:User)-[:FRIENDS_WITH]->(friend:User)
            RETURN u.name, count(friend) as friend_count
            ORDER BY friend_count DESC
          $$) as (name ag_catalog.agtype, friend_count ag_catalog.agtype);
        `)

        // Alice has 2 friends (most)
        expect(res.rows[0].name).toBe('"Alice"')
        expect(res.rows[0].friend_count).toBe('2')
      })
    })
  })
})
