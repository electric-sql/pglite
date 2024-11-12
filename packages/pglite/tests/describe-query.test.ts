import { test, expect } from 'vitest'
import { PGlite } from '../dist/index.js'

test('describeQuery returns parameter and result types', async () => {
  const db = await PGlite.create()
  await db.query(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT,
      age INTEGER,
      active BOOLEAN
    )
  `)

  const description = await db.describeQuery(
    'SELECT name, age FROM users WHERE id = $1 AND active = $2'
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
  const db = await PGlite.create()
  
  const description = await db.describeQuery('SELECT 1')

  expect(description.queryParams).toHaveLength(0)
  expect(description.resultFields).toHaveLength(1)
  expect(description.resultFields[0].dataTypeID).toBe(23) // INTEGER
})

test('describeQuery handles INSERT queries', async () => {
  const db = await PGlite.create()
  await db.query(`
    CREATE TABLE test (
      id INTEGER PRIMARY KEY,
      value TEXT
    )
  `)

  const description = await db.describeQuery(
    'INSERT INTO test (id, value) VALUES ($1, $2)'
  )

  expect(description.queryParams).toHaveLength(2)
  expect(description.queryParams[0].dataTypeID).toBe(23) // INTEGER
  expect(description.queryParams[1].dataTypeID).toBe(25) // TEXT
  expect(description.resultFields).toHaveLength(0) // INSERT typically returns no fields
})

test('describeQuery handles invalid queries', async () => {
  const db = await PGlite.create()

  await expect(db.describeQuery('SELECT * FROM nonexistent_table'))
    .rejects
    .toThrow(/relation "nonexistent_table" does not exist/)
}) 