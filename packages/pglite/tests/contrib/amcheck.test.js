import { it, expect } from 'vitest'
import { PGlite } from '../../dist/index.js'
import { amcheck } from '../../dist/contrib/amcheck.js'

it('amcheck', async () => {
  const pg = new PGlite({
    extensions: {
      amcheck,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS amcheck;')

  // Example query from https://www.postgresql.org/docs/current/amcheck.html
  const res = await pg.query(`
    SELECT bt_index_check(index => c.oid, heapallindexed => i.indisunique),
               c.relname,
               c.relpages
    FROM pg_index i
    JOIN pg_opclass op ON i.indclass[0] = op.oid
    JOIN pg_am am ON op.opcmethod = am.oid
    JOIN pg_class c ON i.indexrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE am.amname = 'btree' AND n.nspname = 'pg_catalog'
    -- Don't check temp tables, which may be from another session:
    AND c.relpersistence != 't'
    -- Function may throw an error when this is omitted:
    AND c.relkind = 'i' AND i.indisready AND i.indisvalid
    ORDER BY c.relpages DESC LIMIT 10;
  `)

  expect(res.rows).toEqual([
    {
      bt_index_check: '',
      relname: 'pg_proc_proname_args_nsp_index',
      relpages: 32,
    },
    {
      bt_index_check: '',
      relname: 'pg_description_o_c_o_index',
      relpages: 23,
    },
    {
      bt_index_check: '',
      relname: 'pg_attribute_relid_attnam_index',
      relpages: 15,
    },
    {
      bt_index_check: '',
      relname: 'pg_proc_oid_index',
      relpages: 12,
    },
    {
      bt_index_check: '',
      relname: 'pg_attribute_relid_attnum_index',
      relpages: 11,
    },
    {
      bt_index_check: '',
      relname: 'pg_depend_depender_index',
      relpages: 10,
    },
    {
      bt_index_check: '',
      relname: 'pg_depend_reference_index',
      relpages: 8,
    },
    {
      bt_index_check: '',
      relname: 'pg_amop_fam_strat_index',
      relpages: 6,
    },
    {
      bt_index_check: '',
      relname: 'pg_operator_oprname_l_r_n_index',
      relpages: 6,
    },
    {
      bt_index_check: '',
      relname: 'pg_amop_opr_fam_index',
      relpages: 6,
    },
  ])
})
