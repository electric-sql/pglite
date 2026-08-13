import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '../dist/index.js'

describe('replication slots', () => {
  let db: PGlite

  beforeEach(async () => {
    db = await PGlite.create()
  })

  afterEach(async () => {
    if (!db.closed) {
      await db.close()
    }
  })

  it('wal_level defaults to logical', async () => {
    const res = await db.query<{ wal_level: string }>(`SHOW wal_level`)
    expect(res.rows[0].wal_level).toBe('logical')
  })

  it('can create, list and drop a logical replication slot', async () => {
    const created = await db.query<{ slot_name: string; lsn: string }>(
      `SELECT * FROM pg_create_logical_replication_slot('test_slot', 'pgoutput')`,
    )
    expect(created.rows[0].slot_name).toBe('test_slot')
    expect(created.rows[0].lsn).toBeTruthy()

    const slots = await db.query<{ slot_name: string; plugin: string }>(
      `SELECT slot_name, plugin FROM pg_replication_slots`,
    )
    expect(slots.rows).toEqual([{ slot_name: 'test_slot', plugin: 'pgoutput' }])

    await db.query(`SELECT pg_drop_replication_slot('test_slot')`)
    const after = await db.query(`SELECT slot_name FROM pg_replication_slots`)
    expect(after.rows).toEqual([])
  })

  it('decodes changes via pgoutput', async () => {
    await db.exec(`
      CREATE TABLE rep_test (id int PRIMARY KEY, value text);
      CREATE PUBLICATION rep_pub FOR ALL TABLES;
    `)
    // slot creation is not allowed in a transaction that has performed
    // writes, so it can't be part of the exec batch above
    await db.query(
      `SELECT pg_create_logical_replication_slot('rep_slot', 'pgoutput')`,
    )

    await db.exec(`
      INSERT INTO rep_test VALUES (1, 'one'), (2, 'two');
      UPDATE rep_test SET value = 'uno' WHERE id = 1;
      DELETE FROM rep_test WHERE id = 2;
    `)

    // peek first - changes must remain available afterwards
    const peeked = await db.query<{ data: Uint8Array }>(
      `SELECT data FROM pg_logical_slot_peek_binary_changes(
        'rep_slot', NULL, NULL,
        'proto_version', '1', 'publication_names', 'rep_pub')`,
    )
    expect(peeked.rows.length).toBeGreaterThan(0)

    // messages start with a tag byte; expect insert (I), update (U) and delete (D)
    const tags = peeked.rows.map((r) => String.fromCharCode(r.data[0]))
    expect(tags).toContain('I')
    expect(tags).toContain('U')
    expect(tags).toContain('D')

    // consuming advances the slot
    const consumed = await db.query(
      `SELECT lsn FROM pg_logical_slot_get_binary_changes(
        'rep_slot', NULL, NULL,
        'proto_version', '1', 'publication_names', 'rep_pub')`,
    )
    expect(consumed.rows.length).toBe(peeked.rows.length)

    const empty = await db.query(
      `SELECT lsn FROM pg_logical_slot_get_binary_changes(
        'rep_slot', NULL, NULL,
        'proto_version', '1', 'publication_names', 'rep_pub')`,
    )
    expect(empty.rows).toEqual([])
  })

  it('recovers cleanly from a decoding error', async () => {
    await db.query(
      `SELECT pg_create_logical_replication_slot('err_slot', 'pgoutput')`,
    )

    // pgoutput requires publication_names; this must fail with a proper error
    await expect(
      db.query(
        `SELECT * FROM pg_logical_slot_get_binary_changes('err_slot', NULL, NULL, 'proto_version', '1')`,
      ),
    ).rejects.toThrow(/publication_names/)

    // and the session must still be usable afterwards
    const res = await db.query<{ one: number }>(`SELECT 1 AS one`)
    expect(res.rows[0].one).toBe(1)

    const slots = await db.query<{ slot_name: string; active: boolean }>(
      `SELECT slot_name, active FROM pg_replication_slots`,
    )
    expect(slots.rows).toEqual([{ slot_name: 'err_slot', active: false }])
  })

  it('slots survive a dump/load cycle', async () => {
    await db.exec(`
      CREATE TABLE rep_persist (id int PRIMARY KEY);
      CREATE PUBLICATION persist_pub FOR ALL TABLES;
    `)
    await db.query(
      `SELECT pg_create_logical_replication_slot('persist_slot', 'pgoutput')`,
    )
    const dump = await db.dumpDataDir('none')
    await db.close()

    db = await PGlite.create({ loadDataDir: dump })
    const slots = await db.query<{ slot_name: string }>(
      `SELECT slot_name FROM pg_replication_slots`,
    )
    expect(slots.rows).toEqual([{ slot_name: 'persist_slot' }])

    // the restored slot must still be usable
    await db.exec(`INSERT INTO rep_persist VALUES (1)`)
    const changes = await db.query(
      `SELECT lsn FROM pg_logical_slot_get_binary_changes(
        'persist_slot', NULL, NULL,
        'proto_version', '1', 'publication_names', 'persist_pub')`,
    )
    expect(changes.rows.length).toBeGreaterThan(0)
  })
})
