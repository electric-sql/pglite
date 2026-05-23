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
