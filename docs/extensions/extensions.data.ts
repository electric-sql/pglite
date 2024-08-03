let baseExtensions: Extension[] = [
  {
    name: "pgvector",
    description: `
      Open-source vector similarity search for Postgres.

      Store your vectors with the rest of your data. Supports:
      - exact and approximate nearest neighbor search
      - single-precision, half-precision, binary, and sparse vectors
      - L2 distance, inner product, cosine distance, L1 distance, Hamming distance, and Jaccard distance
    `,
    featured: true,
    repo: "https://github.com/pgvector/pgvector",
    tags: ["postgres extension"],
    importPath: "@electric-sql/pglite/vector",
    importName: "vector",
    core: true,
  },
  {
    name: "live",
    description: `
      A reactive, or "live", query extension for PGlite that enables you to subscribe to a query 
      and receive updated results when the underlying tables change.
    `,
    featured: true,
    repo: "https://github.com/electric-sql/pglite/tree/main/packages/pglite/src/live",
    docs: "/docs/live-queries",
    tags: ["pglite plugin"],
    importPath: "@electric-sql/pglite/live",
    importName: "live",
    core: true,
  },
  {
    name: "adminpack",
    description: `
      adminpack provides a number of support functions which pgAdmin and other 
      administration and management tools can use to provide additional functionality
    `,
    docs: "https://www.postgresql.org/docs/current/adminpack.html",
    tags: ["postgres extension", "postgres/contrib"],
    importPath: "@electric-sql/pglite/contrib/adminpack",
    importName: "adminpack",
    core: true,
  },
  {
    name: "amcheck",
    description: `
      The amcheck module provides functions that allow you to verify the logical 
      consistency of the structure of relations.
    `,
    docs: "https://www.postgresql.org/docs/current/amcheck.html",
    tags: ["postgres extension", "postgres/contrib"],
    importPath: "@electric-sql/pglite/contrib/amcheck",
    importName: "amcheck",
    core: true,
  },
  {
    name: "auto_explain",
    description: `
      The auto_explain module provides a means for logging execution plans of slow 
      statements automatically, without having to run EXPLAIN by hand.
    `,
    docs: "https://www.postgresql.org/docs/current/auto-explain.html",
    tags: ["postgres extension", "postgres/contrib"],
    importPath: "@electric-sql/pglite/contrib/auto_explain",
    importName: "auto_explain",
    core: true,
  },
  {
    name: "bloom",
    description: `
      bloom provides an index access method based on Bloom filters.
      A Bloom filter is a space-efficient data structure that is used to test whether 
      an element is a member of a set. In the case of an index access method, it 
      allows fast exclusion of non-matching tuples via signatures whose size is 
      determined at index creation.
    `,
    repo: "https://www.postgresql.org/docs/current/bloom.html",
    tags: ["postgres extension", "postgres/contrib"],
    importPath: "@electric-sql/pglite/contrib/bloom",
    importName: "bloom",
    core: true,
  },
  {
    name: "btree_gin",
    description: `
      btree_gin provides GIN operator classes that implement B-tree equivalent 
      behavior for many built in data types.
    `,
    docs: "https://www.postgresql.org/docs/current/btree-gin.html",
    tags: ["postgres extension", "postgres/contrib"],
    importPath: "@electric-sql/pglite/contrib/btree_gin",
    importName: "btree_gin",
    core: true,
  },
  {
    name: "btree_gist",
    description: `
      btree_gist provides GiST operator classes that implement B-tree equivalent 
      behavior for many built in data types.
    `,
    docs: "https://www.postgresql.org/docs/current/btree-gist.html",
    tags: ["postgres extension", "postgres/contrib"],
    importPath: "@electric-sql/pglite/contrib/btree_gist",
    importName: "btree_gist",
    core: true,
  },
  {
    name: "citext",
    description: `
      citext provides a case-insensitive character string type, citext. Essentially, 
      it internally calls lower when comparing values. Otherwise, it behaves almost 
      the same as text.
    `,
    docs: "https://www.postgresql.org/docs/current/citext.html",
    tags: ["postgres extension", "postgres/contrib"],
    importPath: "@electric-sql/pglite/contrib/citext",
    importName: "citext",
    core: true,
  },
  {
    name: "cube",
    description: `
      cube provides a data type cube for representing multidimensional cubes.
    `,
    docs: "https://www.postgresql.org/docs/current/cube.html",
    tags: ["postgres extension", "postgres/contrib"],
    importPath: "@electric-sql/pglite/contrib/cube",
    importName: "cube",
    core: true,
  },
  {
    name: "earthdistance",
    description: `
      The earthdistance module provides tools for calculating great circle distances 
      on the surface of the Earth.
    `,
    docs: "https://www.postgresql.org/docs/current/earthdistance.html",
    tags: ["postgres extension", "postgres/contrib"],
    importPath: "@electric-sql/pglite/contrib/earthdistance",
    importName: "earthdistance",
    core: true,
  },
  {
    name: "fuzzystrmatch",
    description: `
      fuzzystrmatch provides functions to determine similarities and distance 
      between strings.
    `,
    docs: "https://www.postgresql.org/docs/current/fuzzystrmatch.html",
    tags: ["postgres extension", "postgres/contrib"],
    importPath: "@electric-sql/pglite/contrib/fuzzystrmatch",
    importName: "fuzzystrmatch",
    core: true,
  },
  {
    name: "hstore",
    description: ` 
      This module implements the hstore data type for storing sets of key/value pairs 
      within a single PostgreSQL value. This can be useful in various scenarios, 
      such as rows with many attributes that are rarely examined, or semi-structured 
      data. Keys and values are simply text strings.
    `,
    docs: "https://www.postgresql.org/docs/current/hstore.html",
    tags: ["postgres extension", "postgres/contrib"],
    importPath: "@electric-sql/pglite/contrib/hstore",
    importName: "hstore",
    core: true,
  },
  {
    name: "isn",
    description: `
      The isn module provides data types for the following international product 
      numbering standards: EAN13, UPC, ISBN (books), ISMN (music), and ISSN (serials).
    `,
    docs: "https://www.postgresql.org/docs/current/isn.html",
    tags: ["postgres extension", "postgres/contrib"],
    importPath: "@electric-sql/pglite/contrib/isn",
    importName: "isn",
    core: true,
  },
  {
    name: "lo",
    description: `
      The lo module provides support for managing Large Objects (also called LOs 
      or BLOBs). This includes a data type lo and a trigger lo_manage.
    `,
    docs: "https://www.postgresql.org/docs/current/lo.html",
    tags: ["postgres extension", "postgres/contrib"],
    importPath: "@electric-sql/pglite/contrib/lo",
    importName: "lo",
    core: true,
  },
  {
    name: "ltree",
    description: `
      This module implements a data type ltree for representing labels of data stored 
      in a hierarchical tree-like structure. Extensive facilities for searching through 
      label trees are provided.
    `,
    docs: "https://www.postgresql.org/docs/current/ltree.html",
    tags: ["postgres extension", "postgres/contrib"],
    importPath: "@electric-sql/pglite/contrib/ltree",
    importName: "ltree",
    core: true,
  },
  {
    name: "pg_trgm",
    description: `
      The pg_trgm module provides functions and operators for determining the similarity 
      of alphanumeric text based on trigram matching, as well as index operator classes 
      that support fast searching for similar strings.
    `,
    docs: "https://www.postgresql.org/docs/current/pgtrgm.html",
    tags: ["postgres extension", "postgres/contrib"],
    importPath: "@electric-sql/pglite/contrib/pg_trgm",
    importName: "pg_trgm",
    core: true,
  },
  {
    name: "seg",
    description: `
      This module implements a data type seg for representing line segments, or 
      floating point intervals. seg can represent uncertainty in the interval endpoints,
      making it especially useful for representing laboratory measurements.
    `,
    docs: "https://www.postgresql.org/docs/current/seg.html",
    tags: ["postgres extension", "postgres/contrib"],
    importPath: "@electric-sql/pglite/contrib/seg",
    importName: "seg",
    core: true,
  },
  {
    name: "tablefunc",
    description: `
      The tablefunc module includes various functions that return tables (that is, 
      multiple rows). These functions are useful both in their own right and as 
      examples of how to write C functions that return multiple rows.
    `,
    docs: "https://www.postgresql.org/docs/current/tablefunc.html",
    tags: ["postgres extension", "postgres/contrib"],
    importPath: "@electric-sql/pglite/contrib/tablefunc",
    importName: "tablefunc",
    core: true,
  },
  {
    name: "tcn",
    description: `
      The tcn module provides a trigger function that notifies listeners of changes to 
      any table on which it is attached. It must be used as an AFTER trigger 
      FOR EACH ROW.
    `,
    docs: "https://www.postgresql.org/docs/current/tcn.html",
    tags: ["postgres extension", "postgres/contrib"],
    importPath: "@electric-sql/pglite/contrib/tcn",
    importName: "tcn",
    core: true,
  },
  {
    name: "tsm_system_rows",
    description: `
      The tsm_system_rows module provides the table sampling method SYSTEM_ROWS, which 
      can be used in the TABLESAMPLE clause of a SELECT command.
    `,
    docs: "https://www.postgresql.org/docs/current/tsm-system-rows.html",
    tags: ["postgres extension", "postgres/contrib"],
    importPath: "@electric-sql/pglite/contrib/tsm_system_rows",
    importName: "tsm_system_rows",
    core: true,
  },
  {
    name: "tsm_system_time",
    description: `
      The tsm_system_time module provides the table sampling method SYSTEM_TIME, which 
      can be used in the TABLESAMPLE clause of a SELECT command.
    `,
    docs: "https://www.postgresql.org/docs/current/tsm-system-time.html",
    tags: ["postgres extension", "postgres/contrib"],
    importPath: "@electric-sql/pglite/contrib/tsm_system_time",
    importName: "tsm_system_time",
  },
  {
    name: "uuid-ossp",
    description: `
      The uuid-ossp module provides functions to generate universally unique 
      identifiers (UUIDs) using one of several standard algorithms. There are also 
      functions to produce certain special UUID constants. This module is only 
      necessary for special requirements beyond what is available in core PostgreSQL.
    `,
    docs: "https://www.postgresql.org/docs/current/uuid-ossp.html",
    tags: ["postgres extension", "postgres/contrib"],
    importPath: "@electric-sql/pglite/contrib/uuid_ossp",
    importName: "uuid_ossp",
  },
];

const tags = [
  "postgres extension",
  "pglite plugin",
  "postgres/contrib",
] as const;

export type Tag = (typeof tags)[number];

export interface Extension {
  name: string;
  description: string;
  descriptionHtml?: string;
  repo?: string;
  homepage?: string;
  docs?: string;
  featured?: boolean;
  tags?: Tag[];
  importPath?: string;
  importName?: string;
  core?: boolean;
  npmPackage?: string;
}

export default {
  async load() {
    const { createMarkdownRenderer } = await import("vitepress");
    const config = (await import("../.vitepress/config.mjs")).default;
    const dedent = (await import("dedent")).default;

    const md = await createMarkdownRenderer(config.srcDir!, config.markdown);

    const extensions = baseExtensions.map((extension) => {
      let descriptionHtml = extension.descriptionHtml;
      if (!descriptionHtml) {
        let description = dedent(extension.description).trim();
        if (extension.core) {
          description +=
            "\n\n" +
            dedent`
          \`${extension.name}\` is included in the main PGlite package.
          `;
        } else if (extension.npmPackage) {
          description += dedent`
          <!-- this comment is a hack to force a new paragraph -->

          ${"```"}sh
          npm install ${extension.npmPackage}
          ${"```"}
          `;
        }
        if (extension.importName && extension.importPath) {
          description +=
            "\n\n" +
            dedent`
          ${"```"}js
          import { ${extension.importName} } from '${extension.importPath}';
          const pg = new PGlite({
            extensions: { ${extension.importName} }
          });
          ${"```"}
          `;
        }
        descriptionHtml = md.render(description);
      }
      return {
        ...extension,
        descriptionHtml,
      };
    });

    return {
      extensions,
      tags,
    };
  },
};
