/**
 * Tests for pg_textsearch extension.
 * Based on tests from https://github.com/timescale/pg_textsearch/tree/main/test/sql
 */
import { describe, it, expect } from 'vitest'
import { testEsmCjsAndDTC } from './test-utils.ts'

await testEsmCjsAndDTC(async (importType) => {
  const { PGlite } =
    importType === 'esm'
      ? await import('../dist/index.js')
      : ((await import(
          '../dist/index.cjs'
        )) as unknown as typeof import('../dist/index.js'))

  const { pg_textsearch } =
    importType === 'esm'
      ? await import('../dist/pg_textsearch/index.js')
      : ((await import(
          '../dist/pg_textsearch/index.cjs'
        )) as unknown as typeof import('../dist/pg_textsearch/index.js'))

  describe(`pg_textsearch`, () => {
    // From test/sql/basic.sql
    it('extension creation and bm25 access method', async () => {
      const pg = new PGlite({
        extensions: {
          pg_textsearch,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_textsearch;')

      // Test bm25 access method exists
      const res = await pg.query<{ amname: string }>(
        "SELECT amname FROM pg_am WHERE amname = 'bm25';",
      )
      expect(res.rows).toHaveLength(1)
      expect(res.rows[0].amname).toBe('bm25')
    })

    // From test/sql/basic.sql - bm25vector type
    it('bm25vector type exists and works', async () => {
      const pg = new PGlite({
        extensions: {
          pg_textsearch,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_textsearch;')

      // Test bm25vector type exists
      const res = await pg.query<{ pg_typeof: string }>(
        "SELECT pg_typeof('my_index:{database:2,system:1}'::bm25vector);",
      )
      expect(res.rows[0].pg_typeof).toBe('bm25vector')

      // Test bm25vector input/output
      const res2 = await pg.query<{ bm25vector: string }>(
        "SELECT 'my_index:{database:2,system:1}'::bm25vector;",
      )
      expect(res2.rows[0].bm25vector).toBe('my_index:{database:2,system:1}')
    })

    // From test/sql/basic.sql - bm25query type
    it('bm25query type exists and works', async () => {
      const pg = new PGlite({
        extensions: {
          pg_textsearch,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_textsearch;')

      // Test bm25query type exists
      const res = await pg.query<{ pg_typeof: string }>(
        "SELECT pg_typeof('search terms'::bm25query);",
      )
      expect(res.rows[0].pg_typeof).toBe('bm25query')

      // Test to_bm25query function
      const res2 = await pg.query<{ to_bm25query: string }>(
        "SELECT to_bm25query('hello world');",
      )
      expect(res2.rows[0].to_bm25query).toBe('hello world')
    })

    // From test/sql/basic.sql - index creation and basic search
    it('bm25 index creation and basic search', async () => {
      const pg = new PGlite({
        extensions: {
          pg_textsearch,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_textsearch;')
      await pg.exec(`
        CREATE TABLE test_docs (id SERIAL PRIMARY KEY, content TEXT);
      `)
      await pg.exec(`
        CREATE INDEX test_tapir_idx ON test_docs USING bm25(content) WITH (text_config='english');
      `)

      // Verify index was created
      const indexRes = await pg.query<{ indexrelid: string }>(`
        SELECT indexrelid::regclass::text as indexrelid FROM pg_index
        WHERE indrelid = 'test_docs'::regclass
        AND indexrelid::regclass::text LIKE '%tapir%';
      `)
      expect(indexRes.rows).toHaveLength(1)
      expect(indexRes.rows[0].indexrelid).toBe('test_tapir_idx')

      // Insert test documents
      await pg.exec(`
        INSERT INTO test_docs (content) VALUES
          ('hello world example'),
          ('database system design'),
          ('the quick brown fox'),
          ('jumped over lazy dog'),
          ('sphinx of black quartz');
      `)

      // Test search with explicit index
      const searchRes = await pg.query<{ content: string; score: number }>(`
        SELECT content, content <@> to_bm25query('hello', 'test_tapir_idx') as score
        FROM test_docs
        ORDER BY score
        LIMIT 1;
      `)
      expect(searchRes.rows).toHaveLength(1)
      expect(searchRes.rows[0].content).toBe('hello world example')
      // BM25 returns negative scores
      expect(searchRes.rows[0].score).toBeLessThan(0)
    })

    // From test/sql/queries.sql - realistic search queries
    it('top-k query patterns', async () => {
      const pg = new PGlite({
        extensions: {
          pg_textsearch,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_textsearch;')
      await pg.exec(`
        CREATE TABLE articles (
          id SERIAL PRIMARY KEY,
          title TEXT,
          content TEXT,
          category TEXT
        );
      `)

      await pg.exec(`
        INSERT INTO articles (title, content, category) VALUES
          ('Introduction to Databases', 'postgresql database management system with advanced indexing capabilities for fast query processing', 'technology'),
          ('Machine Learning Fundamentals', 'machine learning algorithms and artificial intelligence techniques for data analysis and prediction', 'technology'),
          ('Text Search Algorithms', 'full text search with bm25 ranking and relevance scoring for information retrieval systems', 'technology'),
          ('Information Retrieval', 'information retrieval and search engines using vector space models and term frequency analysis', 'technology'),
          ('Natural Language Processing', 'natural language processing techniques including parsing stemming and semantic analysis', 'technology'),
          ('Database Optimization', 'database indexing and query optimization strategies for improving performance in large datasets', 'technology');
      `)

      await pg.exec(`
        CREATE INDEX articles_idx ON articles USING bm25(content) WITH (text_config='english');
      `)

      // Basic text search with LIMIT
      const res1 = await pg.query<{ title: string; score: number }>(`
        SELECT title, ROUND((content <@> to_bm25query('database', 'articles_idx'))::numeric, 4) as score
        FROM articles
        ORDER BY content <@> to_bm25query('database', 'articles_idx')
        LIMIT 3;
      `)
      expect(res1.rows.length).toBeLessThanOrEqual(3)
      // Database-related articles should rank first
      expect(res1.rows[0].title).toMatch(/database/i)

      // Multi-term search
      const res2 = await pg.query<{ title: string; score: number }>(`
        SELECT title, ROUND((content <@> to_bm25query('machine learning', 'articles_idx'))::numeric, 4) as score
        FROM articles
        ORDER BY content <@> to_bm25query('machine learning', 'articles_idx')
        LIMIT 3;
      `)
      expect(res2.rows.length).toBeLessThanOrEqual(3)
      expect(res2.rows[0].title).toBe('Machine Learning Fundamentals')

      // Category-filtered search
      const res3 = await pg.query<{ title: string; score: number }>(`
        SELECT title, ROUND((content <@> to_bm25query('search algorithms', 'articles_idx'))::numeric, 4) as score
        FROM articles
        WHERE category = 'technology'
        ORDER BY content <@> to_bm25query('search algorithms', 'articles_idx')
        LIMIT 5;
      `)
      expect(res3.rows.length).toBeGreaterThan(0)
    })

    // From test/sql/scoring1.sql - bulk vs incremental index build
    it('bulk build mode (insert then create index)', async () => {
      const pg = new PGlite({
        extensions: {
          pg_textsearch,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_textsearch;')
      await pg.exec(`
        CREATE TABLE scoring_bulk (
          id SERIAL PRIMARY KEY,
          content TEXT
        );
      `)

      // Insert test documents first
      await pg.exec(
        "INSERT INTO scoring_bulk (content) VALUES ('hello world');",
      )
      await pg.exec(
        "INSERT INTO scoring_bulk (content) VALUES ('goodbye cruel world');",
      )

      // Create index after data insertion (bulk build)
      await pg.exec(`
        CREATE INDEX scoring_bulk_idx ON scoring_bulk USING bm25(content)
          WITH (text_config='english', k1=1.2, b=0.75);
      `)

      // Query with 'hello'
      const res = await pg.query<{
        id: number
        content: string
        score: number
      }>(`
        SELECT id, content, ROUND((content <@> to_bm25query('hello', 'scoring_bulk_idx'))::numeric, 4) as score
        FROM scoring_bulk
        ORDER BY content <@> to_bm25query('hello', 'scoring_bulk_idx'), id;
      `)

      expect(res.rows).toHaveLength(2)
      // 'hello world' should rank higher (more negative score)
      expect(res.rows[0].content).toBe('hello world')
      expect(res.rows[0].score).toBeLessThan(res.rows[1].score)
    })

    it('incremental build mode (create index then insert)', async () => {
      const pg = new PGlite({
        extensions: {
          pg_textsearch,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_textsearch;')
      await pg.exec(`
        CREATE TABLE scoring_incr (
          id SERIAL PRIMARY KEY,
          content TEXT
        );
      `)

      // Create index before data insertion (incremental build)
      await pg.exec(`
        CREATE INDEX scoring_incr_idx ON scoring_incr USING bm25(content)
          WITH (text_config='english', k1=1.2, b=0.75);
      `)

      // Insert test documents incrementally
      await pg.exec(
        "INSERT INTO scoring_incr (content) VALUES ('hello world');",
      )
      await pg.exec(
        "INSERT INTO scoring_incr (content) VALUES ('goodbye cruel world');",
      )

      // Query with 'cruel'
      const res = await pg.query<{
        id: number
        content: string
        score: number
      }>(`
        SELECT id, content, ROUND((content <@> to_bm25query('cruel', 'scoring_incr_idx'))::numeric, 4) as score
        FROM scoring_incr
        ORDER BY content <@> to_bm25query('cruel', 'scoring_incr_idx'), id;
      `)

      expect(res.rows).toHaveLength(2)
      // 'goodbye cruel world' should rank higher for 'cruel' query
      expect(res.rows[0].content).toBe('goodbye cruel world')
    })

    // From test/sql/strings.sql - various text patterns
    it('handles various text patterns', async () => {
      const pg = new PGlite({
        extensions: {
          pg_textsearch,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_textsearch;')
      await pg.exec(`
        CREATE TABLE text_patterns (
          id SERIAL PRIMARY KEY,
          content TEXT
        );
      `)
      await pg.exec(`
        CREATE INDEX text_patterns_idx ON text_patterns USING bm25(content) WITH (text_config='english');
      `)

      // Insert various text patterns
      await pg.exec(`
        INSERT INTO text_patterns (content) VALUES
          ('simple text'),
          ('UPPERCASE TEXT'),
          ('MiXeD CaSe TeXt'),
          ('text with numbers 123 456'),
          ('special-characters_and.punctuation!'),
          ('repeated word word word word'),
          ('');
      `)

      // Search should be case-insensitive
      const res = await pg.query<{ content: string }>(`
        SELECT content
        FROM text_patterns
        WHERE content <@> to_bm25query('text', 'text_patterns_idx') < 0
        ORDER BY content <@> to_bm25query('text', 'text_patterns_idx');
      `)

      // Should find multiple matches regardless of case
      expect(res.rows.length).toBeGreaterThan(1)
    })

    // From test/sql/updates.sql - update and delete operations
    it('handles updates and deletes', async () => {
      const pg = new PGlite({
        extensions: {
          pg_textsearch,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_textsearch;')
      await pg.exec(`
        CREATE TABLE update_test (
          id SERIAL PRIMARY KEY,
          content TEXT
        );
      `)
      await pg.exec(`
        CREATE INDEX update_test_idx ON update_test USING bm25(content) WITH (text_config='english');
      `)

      // Insert initial data
      await pg.exec(
        "INSERT INTO update_test (content) VALUES ('original content here');",
      )

      // Verify initial search works
      const res1 = await pg.query<{ id: number }>(`
        SELECT id FROM update_test
        WHERE content <@> to_bm25query('original', 'update_test_idx') < 0;
      `)
      expect(res1.rows).toHaveLength(1)

      // Update content
      await pg.exec(
        "UPDATE update_test SET content = 'modified content now' WHERE id = 1;",
      )

      // 'original' should no longer match
      const res2 = await pg.query<{ id: number }>(`
        SELECT id FROM update_test
        WHERE content <@> to_bm25query('original', 'update_test_idx') < 0;
      `)
      expect(res2.rows).toHaveLength(0)

      // 'modified' should match
      const res3 = await pg.query<{ id: number }>(`
        SELECT id FROM update_test
        WHERE content <@> to_bm25query('modified', 'update_test_idx') < 0;
      `)
      expect(res3.rows).toHaveLength(1)

      // Delete
      await pg.exec('DELETE FROM update_test WHERE id = 1;')

      const res4 = await pg.query<{ id: number }>(`
        SELECT id FROM update_test
        WHERE content <@> to_bm25query('modified', 'update_test_idx') < 0;
      `)
      expect(res4.rows).toHaveLength(0)
    })
  })
})
