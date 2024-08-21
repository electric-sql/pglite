import { describe, it, expect } from 'vitest'

await tests('esm')
await tests('cjs')

async function tests(importType) {
  const { PGlite } =
    importType === 'esm'
      ? await import('../dist/index.js')
      : await import('../dist/index.cjs')

  const { live } =
    importType === 'esm'
      ? await import('../dist/live/index.js')
      : await import('../dist/live/index.cjs')

  describe(`live ${importType}`, () => {
    it('basic live query', async () => {
      const db = new PGlite({
        extensions: { live },
      })

      await db.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      number INT
    );
  `)

      await db.exec(`
    INSERT INTO test (number)
    SELECT i*10 FROM generate_series(1, 5) i;
  `)

      let updatedResults
      const eventTarget = new EventTarget()

      const { initialResults, unsubscribe } = await db.live.query(
        'SELECT * FROM test ORDER BY number;',
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

      db.exec('INSERT INTO test (number) VALUES (25);')

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

      db.exec('DELETE FROM test WHERE id = 6;')

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

      db.exec('UPDATE test SET number = 15 WHERE id = 3;')

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

      db.exec('INSERT INTO test (number) VALUES (35);')

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
      const db = new PGlite({
        extensions: { live },
      })

      await db.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      number INT
    );
  `)

      await db.exec(`
    INSERT INTO test (number)
    SELECT i*10 FROM generate_series(1, 5) i;
  `)

      let updatedResults
      const eventTarget = new EventTarget()

      const { initialResults, unsubscribe } = await db.live.query(
        'SELECT * FROM test WHERE number < $1 ORDER BY number;',
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

      db.exec('INSERT INTO test (number) VALUES (25);')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 2, number: 20 },
        { id: 6, number: 25 },
        { id: 3, number: 30 },
      ])

      db.exec('DELETE FROM test WHERE id = 6;')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 2, number: 20 },
        { id: 3, number: 30 },
      ])

      db.exec('UPDATE test SET number = 15 WHERE id = 3;')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 3, number: 15 },
        { id: 2, number: 20 },
      ])

      unsubscribe()

      db.exec('INSERT INTO test (number) VALUES (35);')

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 3, number: 15 },
        { id: 2, number: 20 },
      ])
    })

    it('incremental query unordered', async () => {
      const db = new PGlite({
        extensions: { live },
      })

      await db.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      number INT
    );
  `)

      await db.exec(`
    INSERT INTO test (number)
    VALUES (1), (2);
  `)

      let updatedResults
      const eventTarget = new EventTarget()

      const { initialResults, unsubscribe } = await db.live.incrementalQuery(
        'SELECT * FROM test;',
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

      await db.exec('UPDATE test SET number = 10 WHERE id = 1;')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 2, number: 2 },
        { id: 1, number: 10 },
      ])

      unsubscribe()
    })

    it('basic live incremental query', async () => {
      const db = new PGlite({
        extensions: { live },
      })

      await db.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      number INT
    );
  `)

      await db.exec(`
    INSERT INTO test (number)
    SELECT i*10 FROM generate_series(1, 5) i;
  `)

      let updatedResults
      const eventTarget = new EventTarget()

      const { initialResults, unsubscribe } = await db.live.incrementalQuery(
        'SELECT * FROM test ORDER BY number;',
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

      await db.exec('INSERT INTO test (number) VALUES (25);')

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

      await db.exec('DELETE FROM test WHERE id = 6;')

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

      await db.exec('UPDATE test SET number = 15 WHERE id = 3;')

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

      await db.exec('INSERT INTO test (number) VALUES (35);')

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
      const db = new PGlite({
        extensions: { live },
      })

      await db.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      number INT
    );
  `)

      await db.exec(`
    INSERT INTO test (number)
    SELECT i*10 FROM generate_series(1, 5) i;
  `)

      let updatedResults
      const eventTarget = new EventTarget()

      const { initialResults, unsubscribe } = await db.live.incrementalQuery(
        'SELECT * FROM test WHERE number < $1 ORDER BY number;',
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

      await db.exec('INSERT INTO test (number) VALUES (25);')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 2, number: 20 },
        { id: 6, number: 25 },
        { id: 3, number: 30 },
      ])

      await db.exec('DELETE FROM test WHERE id = 6;')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 2, number: 20 },
        { id: 3, number: 30 },
      ])

      await db.exec('UPDATE test SET number = 15 WHERE id = 3;')

      await new Promise((resolve) =>
        eventTarget.addEventListener('change', resolve, { once: true }),
      )

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 3, number: 15 },
        { id: 2, number: 20 },
      ])

      unsubscribe()

      await db.exec('INSERT INTO test (number) VALUES (35);')

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(updatedResults.rows).toEqual([
        { id: 1, number: 10 },
        { id: 3, number: 15 },
        { id: 2, number: 20 },
      ])
    })

    it('basic live changes', async () => {
      const db = new PGlite({
        extensions: { live },
      })

      await db.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      number INT
    );
  `)

      await db.exec(`
    INSERT INTO test (number)
    SELECT i*10 FROM generate_series(1, 5) i;
  `)

      let updatedChanges
      const eventTarget = new EventTarget()

      const { initialChanges, unsubscribe } = await db.live.changes(
        'SELECT * FROM test ORDER BY number;',
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

      db.exec('INSERT INTO test (number) VALUES (25);')

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

      db.exec('DELETE FROM test WHERE id = 6;')

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

      db.exec('UPDATE test SET number = 15 WHERE id = 3;')

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

      db.exec('INSERT INTO test (number) VALUES (35);')

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
  })
}
