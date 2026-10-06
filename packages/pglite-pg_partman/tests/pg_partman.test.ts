import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { pg_partman } from '../src/index.js'

describe('pg_partman', () => {
  let pg: PGlite
  let dataDirArchive: File | Blob
  beforeEach(async () => {
    // The first test pays initdb + extension install once and snapshots the
    // cluster; restoring it is faster and proves the extension survives a dump/restore.
    if (!dataDirArchive) {
      pg = await PGlite.create({
        extensions: { pg_partman },
      })
      await pg.exec(
        'CREATE SCHEMA partman; CREATE EXTENSION pg_partman SCHEMA partman;',
      )
      dataDirArchive = await pg.dumpDataDir('gzip')
    } else {
      pg = await PGlite.create({
        extensions: { pg_partman },
        loadDataDir: dataDirArchive,
      })
    }
    // pg_partman derives partition boundaries from the session timezone;
    // pin it so child-table suffixes are deterministic
    await pg.exec(`SET TIME ZONE 'UTC';`)
  })
  afterEach(async () => {
    if (!pg.closed) {
      await pg.close()
    }
  })

  const countPartitions = async (parent: string) => {
    const res = await pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM partman.show_partitions('${parent}')`,
    )
    return res.rows[0].n
  }

  it('can load extension', async () => {
    const res = await pg.query<{ extname: string; extversion: string }>(`
        SELECT extname, extversion
        FROM pg_extension
        WHERE extname = 'pg_partman'
      `)

    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].extversion).toBe('5.5.0')
  })

  it('creates a time-partitioned set with premade children, a default partition and a template table', async () => {
    await pg.exec(`
      CREATE SCHEMA partman_test;
      CREATE TABLE partman_test.time_tbl
        (col1 int, col2 text, col3 timestamptz NOT NULL DEFAULT now())
        PARTITION BY RANGE (col3);
      SELECT partman.create_parent('partman_test.time_tbl', 'col3', '1 day');
    `)

    // default premake is 4: four days back, today, four days ahead
    expect(await countPartitions('partman_test.time_tbl')).toBe(9)

    const defaultPartition = await pg.query(`
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'partman_test' AND tablename = 'time_tbl_default'
    `)
    expect(defaultPartition.rows).toHaveLength(1)

    const templateTable = await pg.query(`
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'partman' AND tablename = 'template_partman_test_time_tbl'
    `)
    expect(templateTable.rows).toHaveLength(1)
  })

  it('run_maintenance premakes new time partitions as data arrives', async () => {
    await pg.exec(`
      CREATE SCHEMA partman_test;
      CREATE TABLE partman_test.time_tbl
        (col1 int, col3 timestamptz NOT NULL DEFAULT now())
        PARTITION BY RANGE (col3);
      SELECT partman.create_parent('partman_test.time_tbl', 'col3', '1 day');
      INSERT INTO partman_test.time_tbl (col1) VALUES (1);
      UPDATE partman.part_config SET premake = 6
        WHERE parent_table = 'partman_test.time_tbl';
      SELECT partman.run_maintenance();
    `)

    expect(await countPartitions('partman_test.time_tbl')).toBe(11)
  })

  it('run_maintenance detaches and drops partitions past the retention window', async () => {
    await pg.exec(`
      CREATE SCHEMA partman_test;
      CREATE TABLE partman_test.time_tbl
        (col1 int, col3 timestamptz NOT NULL DEFAULT now())
        PARTITION BY RANGE (col3);
      SELECT partman.create_parent('partman_test.time_tbl', 'col3', '1 day');
    `)
    const before = await countPartitions('partman_test.time_tbl')

    await pg.exec(`
      UPDATE partman.part_config
        SET retention = '2 days', retention_keep_table = false
        WHERE parent_table = 'partman_test.time_tbl';
      SELECT partman.run_maintenance();
    `)

    // of the four premade days in the past, the two beyond the window go away
    expect(await countPartitions('partman_test.time_tbl')).toBe(before - 2)
  })

  it('creates an id-partitioned set and premakes ahead of the max id', async () => {
    await pg.exec(`
      CREATE SCHEMA partman_test;
      CREATE TABLE partman_test.id_tbl
        (col1 bigint NOT NULL, col2 text)
        PARTITION BY RANGE (col1);
      SELECT partman.create_parent('partman_test.id_tbl', 'col1', '10');
    `)
    const before = await countPartitions('partman_test.id_tbl')
    expect(before).toBeGreaterThan(0)

    await pg.exec(`
      INSERT INTO partman_test.id_tbl
        SELECT g, 'row ' || g FROM generate_series(1, 35) g;
      SELECT partman.run_maintenance();
    `)

    expect(await countPartitions('partman_test.id_tbl')).toBeGreaterThan(before)
  })

  it('show_partition_name locates the child table for a value', async () => {
    await pg.exec(`
      CREATE SCHEMA partman_test;
      CREATE TABLE partman_test.id_tbl
        (col1 bigint NOT NULL, col2 text)
        PARTITION BY RANGE (col1);
      SELECT partman.create_parent('partman_test.id_tbl', 'col1', '10');
    `)

    const res = await pg.query<{
      partition_table: string
      table_exists: boolean
    }>(`
      SELECT partition_table, table_exists
      FROM partman.show_partition_name('partman_test.id_tbl', '15')
    `)

    expect(res.rows[0].partition_table).toBe('id_tbl_p10')
    expect(res.rows[0].table_exists).toBe(true)
  })
})
