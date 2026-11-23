import { test, expect, afterEach, beforeEach } from 'vitest'
import { PGlite } from '../dist/index.js'

let pg: PGlite
let dataDirArchive: File | Blob
beforeEach(async () => {
  if (!dataDirArchive) {
    pg = await PGlite.create()
    dataDirArchive = await pg.dumpDataDir('gzip')
  } else {
    pg = await PGlite.create()
  }
})
afterEach(async () => {
  if (!pg.closed) {
    await pg.close()
  }
})

test('describeQuery returns parameter and result types', async () => {
  await pg.query(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT,
      age INTEGER,
      active BOOLEAN
    )
  `)

  const description = await pg.describeQuery(
    'SELECT name, age FROM users WHERE id = $1 AND active = $2',
  )

  // Check parameter types
  expect(description.queryParams).toHaveLength(2)
  expect(description.queryParams[0].dataTypeID).toBe(23) // INTEGER
  expect(description.queryParams[1].dataTypeID).toBe(16) // BOOLEAN
  expect(description.queryParams[0].serializer).toBeDefined()
  expect(description.queryParams[1].serializer).toBeDefined()

  // Check result field types
  expect(description.resultFields).toHaveLength(2)
  expect(description.resultFields[0].name).toBe('name')
  expect(description.resultFields[0].dataTypeID).toBe(25) // TEXT
  expect(description.resultFields[1].name).toBe('age')
  expect(description.resultFields[1].dataTypeID).toBe(23) // INTEGER
  expect(description.resultFields[0].parser).toBeDefined()
  expect(description.resultFields[1].parser).toBeDefined()
})

test('describeQuery handles queries with no parameters or results', async () => {
  const description = await pg.describeQuery('SELECT 1')

  expect(description.queryParams).toHaveLength(0)
  expect(description.resultFields).toHaveLength(1)
  expect(description.resultFields[0].dataTypeID).toBe(23) // INTEGER
})

test('describeQuery handles INSERT queries', async () => {
  await pg.query(`
    CREATE TABLE test (
      id INTEGER PRIMARY KEY,
      value TEXT
    )
  `)

  const description = await pg.describeQuery(
    'INSERT INTO test (id, value) VALUES ($1, $2)',
  )

  expect(description.queryParams).toHaveLength(2)
  expect(description.queryParams[0].dataTypeID).toBe(23) // INTEGER
  expect(description.queryParams[1].dataTypeID).toBe(25) // TEXT
  expect(description.resultFields).toHaveLength(0) // INSERT typically returns no fields
})

test('describeQuery handles invalid queries', async () => {
  await expect(
    pg.describeQuery('SELECT * FROM nonexistent_table'),
  ).rejects.toThrow(/relation "nonexistent_table" does not exist/)
})

test('concurrent descriptions match serial descriptions', async () => {
  const queries = [
    'SELECT $1::integer AS number_value',
    'SELECT $1::text AS text_value',
  ]
  const serial = [
    await pg.describeQuery(queries[0]),
    await pg.describeQuery(queries[1]),
  ]

  const concurrent = await Promise.all(
    queries.map((query) => pg.describeQuery(query)),
  )

  expect(concurrent).toEqual(serial)
})

test('describeQuery does not borrow a concurrent query result', async () => {
  const [result, description] = await Promise.all([
    pg.query('SELECT $1::integer AS number_value', [42]),
    pg.describeQuery('SELECT $1::text AS text_value'),
  ])

  expect(result.rows).toEqual([{ number_value: 42 }])
  expect(description).toMatchObject({
    queryParams: [{ dataTypeID: 25 }],
    resultFields: [{ name: 'text_value', dataTypeID: 25 }],
  })
  expect((await pg.query('SELECT 7 AS healthy')).rows).toEqual([{ healthy: 7 }])
})

test('describeQuery waits for an active transaction', async () => {
  let release!: () => void
  let entered!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const transaction = pg.transaction(async (tx) => {
    await tx.query('SELECT 1')
    entered()
    await held
  })
  await started

  let descriptionDone = false
  let queryDone = false
  const description = pg
    .describeQuery('SELECT $1::integer AS described')
    .then((result) => {
      descriptionDone = true
      return result
    })
  const query = pg.query('SELECT 2 AS normal').then((result) => {
    queryDone = true
    return result
  })
  try {
    // Drain the already-started operation's microtasks while the transaction is held.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(descriptionDone).toBe(false)
    expect(queryDone).toBe(false)
  } finally {
    release()
    await Promise.allSettled([transaction, description, query])
  }
  await transaction
  expect((await description).resultFields[0].name).toBe('described')
  expect((await query).rows).toEqual([{ normal: 2 }])
})

test('describeQuery waits for a newly constructed database', async () => {
  const starting = new PGlite()
  try {
    const description = await starting.describeQuery(
      'SELECT $1::integer AS value',
    )
    expect(description).toMatchObject({
      queryParams: [{ dataTypeID: 23 }],
      resultFields: [{ name: 'value', dataTypeID: 23 }],
    })
  } finally {
    await starting.waitReady
    await starting.close()
  }
})
