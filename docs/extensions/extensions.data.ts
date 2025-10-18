const baseExtensions: Extension[] = [
  {
    name: 'pgvector',
    description: `
      Open-source vector similarity search for Postgres.

      Store your vectors with the rest of your data. Supports:
      - exact and approximate nearest neighbor search
      - single-precision, half-precision, binary, and sparse vectors
      - L2 distance, inner product, cosine distance, L1 distance, Hamming distance, and Jaccard distance
    `,
    shortDescription: 'Open-source vector similarity search for Postgres.',
    featured: true,
    repo: 'https://github.com/pgvector/pgvector',
    tags: ['postgres extension'],
    importPath: '@electric-sql/pglite/vector',
    importName: 'vector',
    core: true,
    size: 43953,
  },
  {
    name: 'live',
    description: `
      A reactive, or "live", query extension for PGlite that enables you to subscribe to a query 
      and receive updated results when the underlying tables change.
    `,
    shortDescription: "A reactive, or 'live', query extension for PGlite.",
    featured: true,
    repo: 'https://github.com/electric-sql/pglite/tree/main/packages/pglite/src/live',
    docs: '/docs/live-queries',
    tags: ['pglite plugin'],
    importPath: '@electric-sql/pglite/live',
    importName: 'live',
    core: true,
    size: 21766,
  },
  {
    name: 'amcheck',
    description: `
      The amcheck module provides functions that allow you to verify the logical 
      consistency of the structure of relations.
    `,
    shortDescription: 'Verify the logical consistency of relations.',
    docs: 'https://www.postgresql.org/docs/current/amcheck.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/amcheck',
    importName: 'amcheck',
    core: true,
    size: 18815,
  },
  {
    name: 'auto_explain',
    description: `
      The auto_explain module provides a means for logging execution plans of slow 
      statements automatically, without having to run EXPLAIN by hand.
    `,
    shortDescription: 'Log execution plans of slow statements automatically.',
    docs: 'https://www.postgresql.org/docs/current/auto-explain.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/auto_explain',
    importName: 'auto_explain',
    core: true,
    size: 3125,
  },
  {
    name: 'bloom',
    description: `
      bloom provides an index access method based on Bloom filters.
      A Bloom filter is a space-efficient data structure that is used to test whether 
      an element is a member of a set. In the case of an index access method, it 
      allows fast exclusion of non-matching tuples via signatures whose size is 
      determined at index creation.
    `,
    shortDescription: 'Index access method based on Bloom filters.',
    repo: 'https://www.postgresql.org/docs/current/bloom.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/bloom',
    importName: 'bloom',
    core: true,
    size: 6197,
  },
  {
    name: 'btree_gin',
    description: `
      btree_gin provides GIN operator classes that implement B-tree equivalent 
      behavior for many built in data types.
    `,
    shortDescription: 'GIN operator classes that implement B-tree behavior.',
    docs: 'https://www.postgresql.org/docs/current/btree-gin.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/btree_gin',
    importName: 'btree_gin',
    core: true,
    size: 6347,
  },
  {
    name: 'btree_gist',
    description: `
      btree_gist provides GiST operator classes that implement B-tree equivalent 
      behavior for many built in data types.
    `,
    shortDescription: 'GiST operator classes that implement B-tree behavior.',
    docs: 'https://www.postgresql.org/docs/current/btree-gist.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/btree_gist',
    importName: 'btree_gist',
    core: true,
    size: 24181,
  },
  {
    name: 'citext',
    description: `
      citext provides a case-insensitive character string type, citext. Essentially, 
      it internally calls lower when comparing values. Otherwise, it behaves almost 
      the same as text.
    `,
    shortDescription: 'Case-insensitive character string type.',
    docs: 'https://www.postgresql.org/docs/current/citext.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/citext',
    importName: 'citext',
    core: true,
    size: 4983,
  },
  {
    name: 'cube',
    description: `
      cube provides a data type cube for representing multidimensional cubes.
    `,
    shortDescription: 'Multidimensional cubes data type.',
    docs: 'https://www.postgresql.org/docs/current/cube.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/cube',
    importName: 'cube',
    core: true,
    size: 15104,
  },
  {
    name: 'earthdistance',
    description: `
      The earthdistance module provides tools for calculating great circle distances 
      on the surface of the Earth.
    `,
    shortDescription: 'Calculate great circle distances on the Earth.',
    docs: 'https://www.postgresql.org/docs/current/earthdistance.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/earthdistance',
    importName: 'earthdistance',
    core: true,
    size: 2220,
  },
  {
    name: 'fuzzystrmatch',
    description: `
      fuzzystrmatch provides functions to determine similarities and distance 
      between strings.
    `,
    shortDescription: 'Determine similarities and distance between strings.',
    docs: 'https://www.postgresql.org/docs/current/fuzzystrmatch.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/fuzzystrmatch',
    importName: 'fuzzystrmatch',
    core: true,
    size: 12026,
  },
  {
    name: 'hstore',
    description: ` 
      This module implements the hstore data type for storing sets of key/value pairs 
      within a single PostgreSQL value. This can be useful in various scenarios, 
      such as rows with many attributes that are rarely examined, or semi-structured 
      data. Keys and values are simply text strings.
    `,
    shortDescription: 'Key/value pairs data type.',
    docs: 'https://www.postgresql.org/docs/current/hstore.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/hstore',
    importName: 'hstore',
    core: true,
    size: 21380,
  },
  {
    name: 'intarray',
    description: `
      The intarray module provides a number of useful functions and operators for 
      manipulating null-free arrays of integers. There is also support for indexed 
      searches using some of the operators.
    `,
    shortDescription: 'Operators for manipulating null-free arrays of integers',
    docs: 'https://www.postgresql.org/docs/9.1/intarray.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/intarray',
    importName: 'intarray',
    core: true,
    size: 14712,
  },
  {
    name: 'dict_xsyn',
    description: `
      dict_xsyn (Extended Synonym Dictionary) is an example of an add-on dictionary 
      template for full-text search. This dictionary type replaces words with groups 
      of their synonyms, and so makes it possible to search for a word using any of 
      its synonyms.
    `,
    shortDescription: 'Example synonym full-text search dictionary',
    docs: 'https://www.postgresql.org/docs/18/dict-xsyn.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/dict_xsyn',
    importName: 'dict_xsyn',
    core: true,
    size: 1948,
  },
  {
    name: 'pageinspect',
    description: `
      The pageinspect module provides functions that allow you to inspect the contents 
      of database pages at a low level, which is useful for debugging purposes. All of 
      these functions may be used only by superusers.
    `,
    shortDescription: 'Low-level inspection of database pages ',
    docs: 'https://www.postgresql.org/docs/18/pageinspect.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/pageinspect',
    importName: 'pageinspect',
    core: true,
    size: 15923,
  },
  {
    name: 'dict_int',
    description: `
      dict_int is an example of an add-on dictionary template for full-text search. 
      The motivation for this example dictionary is to control the indexing of integers 
      (signed and unsigned), allowing such numbers to be indexed while preventing 
      excessive growth in the number of unique words, which greatly affects the 
      performance of searching.
    `,
    shortDescription: 'Example full-text search dictionary for integers',
    docs: 'https://www.postgresql.org/docs/18/dict-int.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/dict_int',
    importName: 'dict_int',
    core: true,
    size: 1361,
  },
  {
    name: 'unaccent',
    description: `
      unaccent is a text search dictionary that removes accents (diacritic signs) 
      from lexemes. It's a filtering dictionary, which means its output is always 
      passed to the next dictionary (if any), unlike the normal behavior of 
      dictionaries. This allows accent-insensitive processing for full text search.
    `,
    shortDescription: 'A text search dictionary which removes diacritics',
    docs: 'https://www.postgresql.org/docs/current/unaccent.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/unaccent',
    importName: 'unaccent',
    core: true,
    size: 9323,
  },
  {
    name: 'pg_surgery',
    description: `
      The pg_surgery module provides various functions to perform surgery on a damaged 
      relation. These functions are unsafe by design and using them may corrupt 
      (or further corrupt) your database. For example, these functions can easily be 
      used to make a table inconsistent with its own indexes, to cause UNIQUE or 
      FOREIGN KEY constraint violations, or even to make tuples visible which, when read, 
      will cause a database server crash. They should be used with great caution and 
      only as a last resort.
    `,
    shortDescription: 'Perform low-level surgery on relation data',
    docs: 'https://www.postgresql.org/docs/current/pgsurgery.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/pg_surgery',
    importName: 'pg_surgery',
    core: true,
    size: 2635,
  },
  {
    name: 'pgtap',
    description: `
    pgTAP is a suite of database functions that make it easy to write TAP-emitting unit tests in psql scripts or xUnit-style test functions. The TAP output is suitable for harvesting, analysis, and reporting by a TAP harness, such as those used in Perl applications.
    `,
    shortDescription: 'pgTAP',
    docs: '',
    tags: ['postgres extension'],
    importPath: '@electric-sql/pglite/pgtap',
    importName: 'pgtap',
    size: 239428,
  },
  {
    name: 'pg_walinspect',
    description: `
      The pg_walinspect module provides SQL functions that allow you to inspect the 
      contents of write-ahead log of a running PostgreSQL database cluster at a low level, 
      which is useful for debugging, analytical, reporting or educational purposes. 
      It is similar to pg_waldump, but accessible through SQL rather than a separate utility.
    `,
    shortDescription: 'Low-level WAL inspection',
    docs: 'https://www.postgresql.org/docs/current/pgwalinspect.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/pg_walinspect',
    importName: 'pg_walinspect',
    core: true,
    size: 4689,
  },
  {
    name: 'pg_visibility',
    description: `
      The pg_visibility module provides a means for examining the visibility map (VM) 
      and page-level visibility information of a table. It also provides functions to 
      check the integrity of a visibility map and to force it to be rebuilt.
    `,
    shortDescription: 'Visibility map information and utilities',
    docs: 'https://www.postgresql.org/docs/current/pgvisibility.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/pg_visibility',
    importName: 'pg_visibility',
    core: true,
    size: 4159,
  },
  {
    name: 'pg_freespacemap',
    description: `
      The pg_freespacemap module provides a means for examining the free space map (FSM). 
      It provides a function called pg_freespace, or two overloaded functions, to be precise. 
      The functions show the value recorded in the free space map for a given page, or 
      for all pages in the relation.
    `,
    shortDescription: 'Examine the free space map',
    docs: 'https://www.postgresql.org/docs/current/pgfreespacemap.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/pg_freespacemap',
    importName: 'pg_freespacemap',
    core: true,
    size: 1485,
  },
  {
    name: 'pg_buffercache',
    description: `
      The pg_buffercache module provides a means for examining what's happening in the 
      shared buffer cache in real time. It also offers a low-level way to evict data 
      from it, for testing purposes.
    `,
    shortDescription: 'Inspect PostgreSQL buffer cache state',
    docs: 'https://www.postgresql.org/docs/current/pgbuffercache.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/pg_buffercache',
    importName: 'pg_buffercache',
    core: true,
    size: 3133,
  },
  {
    name: 'file_fdw',
    description: `
      The file_fdw module provides the foreign-data wrapper file_fdw, which can be 
      used to access data files in the server's file system, or to execute programs 
      on the server and read their output. The data file or program output must be 
      in a format that can be read by COPY FROM. Access to data files is currently 
      read-only.
    `,
    shortDescription: "Acess data files in the server's file system",
    docs: 'https://www.postgresql.org/docs/18/file-fdw.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/file_fdw',
    importName: 'file_fdw',
    core: true,
    size: 4467,
  },
  {
    name: 'isn',
    description: `
      The isn module provides data types for the following international product 
      numbering standards: EAN13, UPC, ISBN (books), ISMN (music), and ISSN (serials).
    `,
    shortDescription: 'International product numbering standards data types.',
    docs: 'https://www.postgresql.org/docs/current/isn.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/isn',
    importName: 'isn',
    core: true,
    size: 31417,
  },
  {
    name: 'lo',
    description: `
      The lo module provides support for managing Large Objects (also called LOs 
      or BLOBs). This includes a data type lo and a trigger lo_manage.
    `,
    shortDescription: 'Support for managing Large Objects.',
    docs: 'https://www.postgresql.org/docs/current/lo.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/lo',
    importName: 'lo',
    core: true,
    size: 1822,
  },
  {
    name: 'ltree',
    description: `
      This module implements a data type ltree for representing labels of data stored 
      in a hierarchical tree-like structure. Extensive facilities for searching through 
      label trees are provided.
    `,
    shortDescription: 'Hierarchical tree-like structure data type.',
    docs: 'https://www.postgresql.org/docs/current/ltree.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/ltree',
    importName: 'ltree',
    core: true,
    size: 19553,
  },
  {
    name: 'pg_trgm',
    description: `
      The pg_trgm module provides functions and operators for determining the similarity 
      of alphanumeric text based on trigram matching, as well as index operator classes 
      that support fast searching for similar strings.
    `,
    shortDescription: 'Text similarity functions and operators.',
    docs: 'https://www.postgresql.org/docs/current/pgtrgm.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/pg_trgm',
    importName: 'pg_trgm',
    core: true,
    size: 16208,
  },
  {
    name: 'seg',
    description: `
      This module implements a data type seg for representing line segments, or 
      floating point intervals. seg can represent uncertainty in the interval endpoints,
      making it especially useful for representing laboratory measurements.
    `,
    shortDescription: 'Line segments data types.',
    docs: 'https://www.postgresql.org/docs/current/seg.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/seg',
    importName: 'seg',
    core: true,
    size: 10426,
  },
  {
    name: 'tablefunc',
    description: `
      The tablefunc module includes various functions that return tables (that is, 
      multiple rows). These functions are useful both in their own right and as 
      examples of how to write C functions that return multiple rows.
    `,
    shortDescription: 'Functions that return tables.',
    docs: 'https://www.postgresql.org/docs/current/tablefunc.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/tablefunc',
    importName: 'tablefunc',
    core: true,
    size: 5824,
  },
  {
    name: 'tcn',
    description: `
      The tcn module provides a trigger function that notifies listeners of changes to 
      any table on which it is attached. It must be used as an AFTER trigger 
      FOR EACH ROW.
    `,
    shortDescription: 'Trigger function that notifies listeners of changes.',
    docs: 'https://www.postgresql.org/docs/current/tcn.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/tcn',
    importName: 'tcn',
    core: true,
    size: 1914,
  },
  {
    name: 'tsm_system_rows',
    description: `
      The tsm_system_rows module provides the table sampling method SYSTEM_ROWS, which 
      can be used in the TABLESAMPLE clause of a SELECT command.
    `,
    shortDescription: 'Table sampling method SYSTEM_ROWS.',
    docs: 'https://www.postgresql.org/docs/current/tsm-system-rows.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/tsm_system_rows',
    importName: 'tsm_system_rows',
    core: true,
    size: 2048,
  },
  {
    name: 'tsm_system_time',
    description: `
      The tsm_system_time module provides the table sampling method SYSTEM_TIME, which 
      can be used in the TABLESAMPLE clause of a SELECT command.
    `,
    shortDescription: 'Table sampling method SYSTEM_TIME.',
    docs: 'https://www.postgresql.org/docs/current/tsm-system-time.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/tsm_system_time',
    importName: 'tsm_system_time',
    size: 2099,
  },
  {
    name: 'uuid-ossp',
    description: `
      The uuid-ossp module provides functions to generate universally unique 
      identifiers (UUIDs) using one of several standard algorithms. There are also 
      functions to produce certain special UUID constants. This module is only 
      necessary for special requirements beyond what is available in core PostgreSQL.
    `,
    shortDescription: 'Aditional functions for generating UUIDs.',
    docs: 'https://www.postgresql.org/docs/current/uuid-ossp.html',
    tags: ['postgres extension', 'postgres/contrib'],
    importPath: '@electric-sql/pglite/contrib/uuid_ossp',
    importName: 'uuid_ossp',
    size: 17936,
  },
  {
    name: 'pg_ivm',
    description: `
    The pg_ivm module provides Incremental View Maintenance (IVM) feature for PostgreSQL.
    Incremental View Maintenance (IVM) is a way to make materialized views up-to-date in 
    which only incremental changes are computed and applied on views rather than 
    recomputing the contents from scratch as REFRESH MATERIALIZED VIEW does. 
    IVM can update materialized views more efficiently than recomputation 
    when only small parts of the view are changed.
    `,
    shortDescription:
      'Incremental View Maintenance (IVM) feature for PostgreSQL.',
    docs: 'https://github.com/sraoss/pg_ivm',
    tags: ['postgres extension'],
    importPath: '@electric-sql/pglite/pg_ivm',
    importName: 'pg_ivm',
    size: 24865,
  },
]

const tags = [
  'postgres extension',
  'pglite plugin',
  'postgres/contrib',
] as const

export type Tag = (typeof tags)[number]

export interface Extension {
  name: string
  description: string
  shortDescription?: string
  descriptionHtml?: string
  repo?: string
  homepage?: string
  docs?: string
  featured?: boolean
  tags?: Tag[]
  importPath?: string
  importName?: string
  core?: boolean
  npmPackage?: string
  size?: number
}

export default {
  async load() {
    const { createMarkdownRenderer } = await import('vitepress')
    const config = (await import('../.vitepress/config.mjs')).default
    const dedent = (await import('dedent')).default

    const md = await createMarkdownRenderer(config.srcDir!, config.markdown)

    const extensions = baseExtensions.map((extension) => {
      let descriptionHtml = extension.descriptionHtml
      if (!descriptionHtml) {
        let description = dedent(extension.description).trim()
        if (extension.core) {
          description +=
            '\n\n' +
            dedent`
          \`${extension.name}\` is included in the main PGlite package.
          `
        } else if (extension.npmPackage) {
          description += dedent`
          <!-- this comment is a hack to force a new paragraph -->

          ${'```'}sh
          npm install ${extension.npmPackage}
          ${'```'}
          `
        }
        if (extension.importName && extension.importPath) {
          description +=
            '\n\n' +
            dedent`
          ${'```'}js
          import { ${extension.importName} } from '${extension.importPath}';
          const pg = new PGlite({
            extensions: { ${extension.importName} }
          });
          ${'```'}
          `
        }
        descriptionHtml = md.render(description)
      }
      return {
        ...extension,
        descriptionHtml,
      }
    })

    return {
      extensions,
      tags,
    }
  },
}
