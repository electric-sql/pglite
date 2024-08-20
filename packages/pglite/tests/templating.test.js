import test from 'ava'
import { query, sql, raw, identifier } from '../dist/templating.js'

test('should leave plain query untouched', (t) => {
  t.deepEqual(query`SELECT * FROM test WHERE value = $1;`, {
    query: 'SELECT * FROM test WHERE value = $1;',
    params: [],
  })

  t.deepEqual(
    query`
    CREATE TABLE test (
      id SERIAL PRIMARY KEY,
      value TEXT
    );`,
    {
      query: `
    CREATE TABLE test (
      id SERIAL PRIMARY KEY,
      value TEXT
    );`,
      params: [],
    },
  )
})

test('should parametrize templated values', (t) => {
  t.deepEqual(query`SELECT * FROM test WHERE value = ${'foo'};`, {
    query: 'SELECT * FROM test WHERE value = $1;',
    params: ['foo'],
  })

  t.deepEqual(
    query`SELECT * FROM test WHERE value = ${'foo'} AND num = ${3};`,
    {
      query: 'SELECT * FROM test WHERE value = $1 AND num = $2;',
      params: ['foo', 3],
    },
  )
})

test('should correctly escape identifiers', (t) => {
  t.deepEqual(
    query`
    CREATE TABLE ${identifier`test`} (
      id SERIAL PRIMARY KEY,
      value TEXT
    );`,
    {
      query: `
    CREATE TABLE "test" (
      id SERIAL PRIMARY KEY,
      value TEXT
    );`,
      params: [],
    },
  )

  t.deepEqual(query`SELECT * FROM ${identifier`test_${2 + 3}_${'dance'}`};`, {
    query: 'SELECT * FROM "test_5_dance";',
    params: [],
  })
})

test('should correctly escape raw sql', (t) => {
  t.deepEqual(
    query`SELECT * FROM test ${raw`WHERE value = ${"'foo'"} AND num = ${3}`};`,
    {
      query: "SELECT * FROM test WHERE value = 'foo' AND num = 3;",
      params: [],
    },
  )

  t.deepEqual(
    query`SELECT * FROM test ${raw`WHERE value = ${"'foo'"} AND num = ${3}`};`,
    {
      query: "SELECT * FROM test WHERE value = 'foo' AND num = 3;",
      params: [],
    },
  )
})

test('should be able to nest templated statements', (t) => {
  const getStmt = (filterVar) =>
    query`SELECT * FROM ${identifier`test`}${filterVar !== undefined ? sql` WHERE ${identifier`foo`} = ${filterVar}` : sql``};`

  t.deepEqual(getStmt('foo'), {
    query: 'SELECT * FROM "test" WHERE "foo" = $1;',
    params: ['foo'],
  })

  t.deepEqual(getStmt(), {
    query: 'SELECT * FROM "test";',
    params: [],
  })
})

test('should parametrize without accounting for non-parameter values', (t) => {
  t.deepEqual(
    query`SELECT * FROM ${identifier`test`} ${raw`WHERE value = ${"'foo'"}`} AND num = ${3};`,
    {
      query: 'SELECT * FROM "test" WHERE value = \'foo\' AND num = $1;',
      params: [3],
    },
  )
})
