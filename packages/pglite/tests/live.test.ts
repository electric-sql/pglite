import { describe, it, expect } from 'vitest'
import { testEsmAndCjs } from './test-utils.js'

await testEsmAndCjs(async (importType) => {
  const { PGlite } = (
    importType === 'esm'
      ? await import('../dist/index.js')
      : await import('../dist/index.cjs')
  ) as typeof import('../dist/index.js')

  const { live } =
    importType === 'esm'
      ? await import('../dist/live/index.js')
      : await import('../dist/live/index.cjs')

  describe(`live ${importType}`, () => {
    it('basic live query', async () => {
      const db = await PGlite.create({
        extensions: { live },
      })

      await db.exec(`
        CREATE TABLE IF NOT EXISTS testTable (
          id SERIAL PRIMARY KEY,
          number INT
        );
      `)

      await db.exec(`
        INSERT INTO testTable (number)
        SELECT i*10 FROM generate_series(1, 5) i;
      `)

      let updatedResults
      const eventTarget = new EventTarget()

      const { initialResults, unsubscribe } = await db.live.query(
        'SELECT * FROM testTable ORDER BY number;',
        [],
        (result) => {
          updatedResults = result
          eventTarget.dispatchEvent(new Event('change'))
        },
      )

      expect(initialResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 2, number: 20 },
        { id: 3, number: 30 },
        { id: 4, number: 40 },
        { id: 5, number: 50 },
      ])

      db.exec('INSERT INTO testTable (number) VALUES (25);')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 2, number: 20 },
        { id: 6, number: 25 },
        { id: 3, number: 30 },
        { id: 4, number: 40 },
        { id: 5, number: 50 },
      ])

      db.exec('DELETE FROM testTable WHERE id = 6;')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 2, number: 20 },
        { id: 3, number: 30 },
        { id: 4, number: 40 },
        { id: 5, number: 50 },
      ])

      db.exec('UPDATE testTable SET number = 15 WHERE id = 3;')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 3, number: 15 },
        { id: 2, number: 20 },
        { id: 4, number: 40 },
        { id: 5, number: 50 },
      ])

      unsubscribe()

      db.exec('INSERT INTO testTable (number) VALUES (35);')

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 3, number: 15 },
        { id: 2, number: 20 },
        { id: 4, number: 40 },
        { id: 5, number: 50 },
      ])
    })

    it('live query on view', async () => {
      const db = await PGlite.create({
        extensions: { live },
      })

      await db.exec(`
        CREATE TABLE IF NOT EXISTS testTable (
          id SERIAL PRIMARY KEY,
          number INT
        );
      `)

      await db.exec(`
        CREATE OR REPLACE VIEW testView2 AS
        SELECT * FROM testTable;
      `)

      await db.exec(`
        CREATE OR REPLACE VIEW testView1 AS
        SELECT * FROM testView2;
      `)

      await db.exec(`
        CREATE OR REPLACE VIEW testView AS
        SELECT * FROM testView1;
      `)

      await db.exec(`
        INSERT INTO testTable (number)
        SELECT i*10 FROM generate_series(1, 5) i;
      `)

      let updatedResults
      const eventTarget = new EventTarget()

      const { initialResults, unsubscribe } = await db.live.query(
        'SELECT * FROM testView ORDER BY number;',
        [],
        (result) => {
          updatedResults = result
          eventTarget.dispatchEvent(new Event('change'))
        },
      )

      expect(initialResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 2, number: 20 },
        { id: 3, number: 30 },
        { id: 4, number: 40 },
        { id: 5, number: 50 },
      ])

      db.exec('INSERT INTO testTable (number) VALUES (25);')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 2, number: 20 },
        { id: 6, number: 25 },
        { id: 3, number: 30 },
        { id: 4, number: 40 },
        { id: 5, number: 50 },
      ])

      db.exec('DELETE FROM testTable WHERE id = 6;')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 2, number: 20 },
        { id: 3, number: 30 },
        { id: 4, number: 40 },
        { id: 5, number: 50 },
      ])

      db.exec('UPDATE testTable SET number = 15 WHERE id = 3;')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 3, number: 15 },
        { id: 2, number: 20 },
        { id: 4, number: 40 },
        { id: 5, number: 50 },
      ])

      unsubscribe()

      db.exec('INSERT INTO testTable (number) VALUES (35);')

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 3, number: 15 },
        { id: 2, number: 20 },
        { id: 4, number: 40 },
        { id: 5, number: 50 },
      ])
    })

    it('live query with params', async () => {
      const db = await PGlite.create({
        extensions: { live },
      })

      await db.exec(`
        CREATE TABLE IF NOT EXISTS testTable (
          id SERIAL PRIMARY KEY,
          number INT
        );
      `)

      await db.exec(`
        INSERT INTO testTable (number)
        SELECT i*10 FROM generate_series(1, 5) i;
      `)

      let updatedResults
      const eventTarget = new EventTarget()

      const { initialResults, unsubscribe } = await db.live.query(
        'SELECT * FROM testTable WHERE number < $1 ORDER BY number;',
        [40],
        (result) => {
          updatedResults = result
          eventTarget.dispatchEvent(new Event('change'))
        },
      )

      expect(initialResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 2, number: 20 },
        { id: 3, number: 30 },
      ])

      db.exec('INSERT INTO testTable (number) VALUES (25);')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 2, number: 20 },
        { id: 6, number: 25 },
        { id: 3, number: 30 },
      ])

      db.exec('DELETE FROM testTable WHERE id = 6;')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 2, number: 20 },
        { id: 3, number: 30 },
      ])

      db.exec('UPDATE testTable SET number = 15 WHERE id = 3;')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 3, number: 15 },
        { id: 2, number: 20 },
      ])

      unsubscribe()

      db.exec('INSERT INTO testTable (number) VALUES (35);')

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 3, number: 15 },
        { id: 2, number: 20 },
      ])
    })

    it('incremental query unordered', async () => {
      const db = await PGlite.create({
        extensions: { live },
      })

      await db.exec(`
        CREATE TABLE IF NOT EXISTS testTable (
          id SERIAL PRIMARY KEY,
          number INT
        );
      `)

      await db.exec(`
        INSERT INTO testTable (number)
        VALUES (1), (2);
      `)

      let updatedResults
      const eventTarget = new EventTarget()

      const { initialResults, unsubscribe } = await db.live.incrementalQuery(
        'SELECT * FROM testTable;',
        [],
        'id',
        (result) => {
          updatedResults = result
          eventTarget.dispatchEvent(new Event('change'))
        },
      )

      expect(initialResults.rows).toEqual([
        { id: 1, number: 1 },
        { id: 2, number: 2 },
      ])

      await db.exec('UPDATE testTable SET number = 10 WHERE id = 1;')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 2, number: 2 },
        { id: 1, number: 10 },
      ])

      unsubscribe()
    })

    it('incremental query with non-integer key', async () => {
      const db = await PGlite.create({
        extensions: { live },
      })

      await db.exec(`
        CREATE TABLE IF NOT EXISTS testTable (
          id TEXT PRIMARY KEY,
          number INT
        );
      `)

      await db.exec(`
        INSERT INTO testTable (id, number)
        VALUES ('potato', 1), ('banana', 2);
      `)

      let updatedResults
      const eventTarget = new EventTarget()

      const { initialResults, unsubscribe } = await db.live.incrementalQuery(
        'SELECT * FROM testTable;',
        [],
        'id',
        (result) => {
          updatedResults = result
          eventTarget.dispatchEvent(new Event('change'))
        },
      )

      expect(initialResults.rows).toEqual([
        { id: 'potato', number: 1 },
        { id: 'banana', number: 2 },
      ])

      await db.exec(`UPDATE testTable SET number = 10 WHERE id = 'potato';`)

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 'banana', number: 2 },
        { id: 'potato', number: 10 },
      ])

      unsubscribe()
    })

    it('basic live incremental query', async () => {
      const db = await PGlite.create({
        extensions: { live },
      })

      await db.exec(`
        CREATE TABLE IF NOT EXISTS testTable (
          id SERIAL PRIMARY KEY,
          number INT
        );
      `)

      await db.exec(`
        INSERT INTO testTable (number)
        SELECT i*10 FROM generate_series(1, 5) i;
      `)

      let updatedResults
      const eventTarget = new EventTarget()

      const { initialResults, unsubscribe } = await db.live.incrementalQuery(
        'SELECT * FROM testTable ORDER BY number;',
        [],
        'id',
        (result) => {
          updatedResults = result
          eventTarget.dispatchEvent(new Event('change'))
        },
      )

      expect(initialResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 2, number: 20 },
        { id: 3, number: 30 },
        { id: 4, number: 40 },
        { id: 5, number: 50 },
      ])

      await db.exec('INSERT INTO testTable (number) VALUES (25);')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 2, number: 20 },
        { id: 6, number: 25 },
        { id: 3, number: 30 },
        { id: 4, number: 40 },
        { id: 5, number: 50 },
      ])

      await db.exec('DELETE FROM testTable WHERE id = 6;')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 2, number: 20 },
        { id: 3, number: 30 },
        { id: 4, number: 40 },
        { id: 5, number: 50 },
      ])

      await db.exec('UPDATE testTable SET number = 15 WHERE id = 3;')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 3, number: 15 },
        { id: 2, number: 20 },
        { id: 4, number: 40 },
        { id: 5, number: 50 },
      ])

      unsubscribe()

      await db.exec('INSERT INTO testTable (number) VALUES (35);')

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 3, number: 15 },
        { id: 2, number: 20 },
        { id: 4, number: 40 },
        { id: 5, number: 50 },
      ])
    })

    it('basic live incremental query with limit 1', async () => {
      const db = await PGlite.create({
        extensions: { live },
      })

      await db.exec(`
        CREATE TABLE IF NOT EXISTS testTable (
          id SERIAL PRIMARY KEY,
          number INT
        );
      `)

      await db.exec(`
        INSERT INTO testTable (number) VALUES (10);
      `)

      let updatedResults
      const eventTarget = new EventTarget()

      const { initialResults, unsubscribe } = await db.live.incrementalQuery(
        'SELECT * FROM testTable ORDER BY number ASC LIMIT 1;',
        [],
        'id',
        (result) => {
          updatedResults = result
          eventTarget.dispatchEvent(new Event('change'))
        },
      )

      expect(initialResults.rows).toEqual([{ id: 1, number: 10 }])

      await db.exec('INSERT INTO testTable (number) VALUES (5);')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([{ id: 2, number: 5 }])

      unsubscribe()
    })

    it('live incremental query on view', async () => {
      const db = await PGlite.create({
        extensions: { live },
      })

      await db.exec(`
        CREATE TABLE IF NOT EXISTS testTable (
          id SERIAL PRIMARY KEY,
          number INT
        );
      `)

      await db.exec(`
        CREATE OR REPLACE VIEW testView2 AS
        SELECT * FROM testTable;
      `)

      await db.exec(`
        CREATE OR REPLACE VIEW testView1 AS
        SELECT * FROM testView2;
      `)

      await db.exec(`
        CREATE OR REPLACE VIEW testView AS
        SELECT * FROM testView1;
      `)

      await db.exec(`
        INSERT INTO testTable (number)
        SELECT i*10 FROM generate_series(1, 5) i;
      `)

      let updatedResults
      const eventTarget = new EventTarget()

      const { initialResults, unsubscribe } = await db.live.incrementalQuery(
        'SELECT * FROM testTable ORDER BY number;',
        [],
        'id',
        (result) => {
          updatedResults = result
          eventTarget.dispatchEvent(new Event('change'))
        },
      )

      expect(initialResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 2, number: 20 },
        { id: 3, number: 30 },
        { id: 4, number: 40 },
        { id: 5, number: 50 },
      ])

      await db.exec('INSERT INTO testTable (number) VALUES (25);')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 2, number: 20 },
        { id: 6, number: 25 },
        { id: 3, number: 30 },
        { id: 4, number: 40 },
        { id: 5, number: 50 },
      ])

      await db.exec('DELETE FROM testTable WHERE id = 6;')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 2, number: 20 },
        { id: 3, number: 30 },
        { id: 4, number: 40 },
        { id: 5, number: 50 },
      ])

      await db.exec('UPDATE testTable SET number = 15 WHERE id = 3;')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 3, number: 15 },
        { id: 2, number: 20 },
        { id: 4, number: 40 },
        { id: 5, number: 50 },
      ])

      unsubscribe()

      await db.exec('INSERT INTO testTable (number) VALUES (35);')

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 3, number: 15 },
        { id: 2, number: 20 },
        { id: 4, number: 40 },
        { id: 5, number: 50 },
      ])
    })

    it('live incremental query with params', async () => {
      const db = await PGlite.create({
        extensions: { live },
      })

      await db.exec(`
        CREATE TABLE IF NOT EXISTS testTable (
          id SERIAL PRIMARY KEY,
          number INT
        );
      `)

      await db.exec(`
        INSERT INTO testTable (number)
        SELECT i*10 FROM generate_series(1, 5) i;
      `)

      let updatedResults
      const eventTarget = new EventTarget()

      const { initialResults, unsubscribe } = await db.live.incrementalQuery(
        'SELECT * FROM testTable WHERE number < $1 ORDER BY number;',
        [40],
        'id',
        (result) => {
          updatedResults = result
          eventTarget.dispatchEvent(new Event('change'))
        },
      )

      expect(initialResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 2, number: 20 },
        { id: 3, number: 30 },
      ])

      await db.exec('INSERT INTO testTable (number) VALUES (25);')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 2, number: 20 },
        { id: 6, number: 25 },
        { id: 3, number: 30 },
      ])

      await db.exec('DELETE FROM testTable WHERE id = 6;')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 2, number: 20 },
        { id: 3, number: 30 },
      ])

      await db.exec('UPDATE testTable SET number = 15 WHERE id = 3;')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 3, number: 15 },
        { id: 2, number: 20 },
      ])

      unsubscribe()

      await db.exec('INSERT INTO testTable (number) VALUES (35);')

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 3, number: 15 },
        { id: 2, number: 20 },
      ])
    })

    it('basic live changes', async () => {
      const db = await PGlite.create({
        extensions: { live },
      })

      await db.exec(`
        CREATE TABLE IF NOT EXISTS testTable (
          id SERIAL PRIMARY KEY,
          number INT
        );
      `)

      await db.exec(`
        INSERT INTO testTable (number)
        SELECT i*10 FROM generate_series(1, 5) i;
      `)

      let updatedChanges
      const eventTarget = new EventTarget()

      const { initialChanges, unsubscribe } = await db.live.changes(
        'SELECT * FROM testTable ORDER BY number;',
        [],
        'id',
        (changes) => {
          updatedChanges = changes
          eventTarget.dispatchEvent(new Event('change'))
        },
      )

      expect(initialChanges).toEqual([
        {
          __op__: 'INSERT',
          id: 1,
          number: 10,
          __after__: null,
          __changed_columns__: [],
        },
        {
          __op__: 'INSERT',
          id: 2,
          number: 20,
          __after__: 1,
          __changed_columns__: [],
        },
        {
          __op__: 'INSERT',
          id: 3,
          number: 30,
          __after__: 2,
          __changed_columns__: [],
        },
        {
          __op__: 'INSERT',
          id: 4,
          number: 40,
          __after__: 3,
          __changed_columns__: [],
        },
        {
          __op__: 'INSERT',
          id: 5,
          number: 50,
          __after__: 4,
          __changed_columns__: [],
        },
      ])

      db.exec('INSERT INTO testTable (number) VALUES (25);')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedChanges).toEqual([
        {
          __op__: 'INSERT',
          id: 6,
          number: 25,
          __after__: 2,
          __changed_columns__: [],
        },
        {
          __after__: 6,
          __changed_columns__: ['__after__'],
          __op__: 'UPDATE',
          id: 3,
          number: null,
        },
      ])

      db.exec('DELETE FROM testTable WHERE id = 6;')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedChanges).toEqual([
        {
          __op__: 'DELETE',
          id: 6,
          number: null,
          __after__: null,
          __changed_columns__: [],
        },
        {
          __after__: 2,
          __changed_columns__: ['__after__'],
          __op__: 'UPDATE',
          id: 3,
          number: null,
        },
      ])

      db.exec('UPDATE testTable SET number = 15 WHERE id = 3;')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedChanges).toEqual([
        {
          id: 2,
          __after__: 3,
          __changed_columns__: ['__after__'],
          __op__: 'UPDATE',
          number: null,
        },
        {
          id: 3,
          __after__: 1,
          __changed_columns__: ['number', '__after__'],
          __op__: 'UPDATE',
          number: 15,
        },
        {
          id: 4,
          __after__: 2,
          __changed_columns__: ['__after__'],
          __op__: 'UPDATE',
          number: null,
        },
      ])

      unsubscribe()

      db.exec('INSERT INTO testTable (number) VALUES (35);')

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(updatedChanges).toEqual([
        {
          id: 2,
          __after__: 3,
          __changed_columns__: ['__after__'],
          __op__: 'UPDATE',
          number: null,
        },
        {
          id: 3,
          __after__: 1,
          __changed_columns__: ['number', '__after__'],
          __op__: 'UPDATE',
          number: 15,
        },
        {
          id: 4,
          __after__: 2,
          __changed_columns__: ['__after__'],
          __op__: 'UPDATE',
          number: null,
        },
      ])
    })

    it('subscribe to live query after creation', async () => {
      const db = await PGlite.create({
        extensions: { live },
      })

      await db.exec(`
        CREATE TABLE IF NOT EXISTS testTable (
          id SERIAL PRIMARY KEY,
          number INT
        );
      `)

      await db.exec(`
        INSERT INTO testTable (number)
        SELECT i*10 FROM generate_series(1, 5) i;
      `)

      const eventTarget = new EventTarget()
      let updatedResults

      const { initialResults, subscribe, unsubscribe } = await db.live.query(
        'SELECT * FROM testTable ORDER BY number;',
      )

      expect(initialResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 2, number: 20 },
        { id: 3, number: 30 },
        { id: 4, number: 40 },
        { id: 5, number: 50 },
      ])

      // Subscribe after creation
      subscribe((result) => {
        updatedResults = result
        eventTarget.dispatchEvent(new Event('change'))
      })

      db.exec('INSERT INTO testTable (number) VALUES (25);')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 2, number: 20 },
        { id: 6, number: 25 },
        { id: 3, number: 30 },
        { id: 4, number: 40 },
        { id: 5, number: 50 },
      ])

      unsubscribe()
    })

    it('live changes limit 1', async () => {
      const db = await PGlite.create({
        extensions: { live },
      })

      await db.exec(`
        CREATE TABLE IF NOT EXISTS testTable (
          id SERIAL PRIMARY KEY,
          number INT
        );
      `)

      await db.exec(`
        INSERT INTO testTable (number) VALUES (10);
      `)

      let updatedChanges
      const eventTarget = new EventTarget()

      const { initialChanges, subscribe, unsubscribe } = await db.live.changes({
        query: 'SELECT * FROM testTable ORDER BY number ASC LIMIT 1;',
        params: [],
        key: 'id',
      })

      expect(initialChanges).toEqual([
        {
          __op__: 'INSERT',
          id: 1,
          number: 10,
          __after__: null,
          __changed_columns__: [],
        },
      ])

      subscribe((changes) => {
        updatedChanges = changes
        eventTarget.dispatchEvent(new Event('change'))
      })

      await db.exec('INSERT INTO testTable (number) VALUES (5);')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedChanges).toEqual([
        {
          __op__: 'INSERT',
          id: 2,
          number: 5,
          __after__: null,
          __changed_columns__: [],
        },
        {
          __op__: 'DELETE',
          id: 1,
          number: null,
          __after__: null,
          __changed_columns__: [],
        },
      ])

      unsubscribe()
    })

    it('subscribe to live changes after creation', async () => {
      const db = await PGlite.create({
        extensions: { live },
      })

      await db.exec(`
        CREATE TABLE IF NOT EXISTS testTable (
          id SERIAL PRIMARY KEY,
          number INT
        );
      `)

      await db.exec(`
        INSERT INTO testTable (number)
        SELECT i*10 FROM generate_series(1, 5) i;
      `)

      const eventTarget = new EventTarget()
      let updatedResults

      const { initialResults, subscribe, unsubscribe } =
        await db.live.incrementalQuery(
          'SELECT * FROM testTable ORDER BY number;',
          [],
          'id',
        )

      expect(initialResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 2, number: 20 },
        { id: 3, number: 30 },
        { id: 4, number: 40 },
        { id: 5, number: 50 },
      ])

      // Subscribe after creation
      subscribe((result) => {
        updatedResults = result
        eventTarget.dispatchEvent(new Event('change'))
      })

      db.exec('INSERT INTO testTable (number) VALUES (25);')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 2, number: 20 },
        { id: 6, number: 25 },
        { id: 3, number: 30 },
        { id: 4, number: 40 },
        { id: 5, number: 50 },
      ])

      unsubscribe()
    })

    it('live query with windowing', async () => {
      const db = await PGlite.create({
        extensions: { live },
      })

      await db.exec(`
        CREATE TABLE IF NOT EXISTS testTable (
          id SERIAL PRIMARY KEY,
          number INT
        );
      `)

      await db.exec(`
        INSERT INTO testTable (number)
        SELECT i*10 FROM generate_series(1, 5) i;
      `)

      let updatedResults
      const eventTarget = new EventTarget()

      const { initialResults, unsubscribe, refresh } = await db.live.query({
        query: 'SELECT * FROM testTable ORDER BY number',
        offset: 1,
        limit: 2,
        callback: (result) => {
          updatedResults = result
          eventTarget.dispatchEvent(new Event('change'))
        },
      })

      // Check initial results include windowing metadata
      expect(initialResults.rows).toEqual([
        { id: 2, number: 20 },
        { id: 3, number: 30 },
      ])
      expect(initialResults.offset).toBe(1)
      expect(initialResults.limit).toBe(2)
      expect(initialResults.totalCount).toBe(5)

      // Insert a row that affects the window
      await db.exec('INSERT INTO testTable (number) VALUES (25);')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 2, number: 20 },
        { id: 6, number: 25 },
      ])
      expect(updatedResults.totalCount).toBe(5) // initially its still 5

      // We wait again for the total count to update, this is done lazily
      // as it can be slower to calculate, we want the UI to update fast.
      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.totalCount).toBe(6) // now its 6

      // Test changing window position
      await refresh({ offset: 3, limit: 2 })

      expect(updatedResults.rows).toEqual([
        { id: 3, number: 30 },
        { id: 4, number: 40 },
      ])
      expect(updatedResults.offset).toBe(3)
      expect(updatedResults.limit).toBe(2)
      expect(updatedResults.totalCount).toBe(6)

      // Delete rows to affect totalCount
      await db.exec('DELETE FROM testTable WHERE number > 30;')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([{ id: 3, number: 30 }])
      expect(updatedResults.totalCount).toBe(6) // initially its still 6

      // We wait again for the total count to update
      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.totalCount).toBe(4) // now its 4

      unsubscribe()
    })

    it('throws error when only one of offset/limit is provided', async () => {
      const db = await PGlite.create({
        extensions: { live },
      })

      await expect(
        db.live.query({
          query: 'SELECT * FROM (VALUES (1)) t',
          offset: 0,
        }),
      ).rejects.toThrow('offset and limit must be provided together')

      await expect(
        db.live.query({
          query: 'SELECT * FROM (VALUES (1)) t',
          limit: 10,
        }),
      ).rejects.toThrow('offset and limit must be provided together')
    })

    it('throws error when offset/limit are not numbers', async () => {
      const db = await PGlite.create({
        extensions: { live },
      })

      await expect(
        db.live.query({
          query: 'SELECT * FROM (VALUES (1)) t',
          offset: '0' as any,
          limit: 10,
        }),
      ).rejects.toThrow('offset and limit must be numbers')

      await expect(
        db.live.query({
          query: 'SELECT * FROM (VALUES (1)) t',
          offset: 0,
          limit: '10' as any,
        }),
      ).rejects.toThrow('offset and limit must be numbers')
    })
  })
})
