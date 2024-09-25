import { describe, it, expect } from 'vitest'
import { query, sql, raw, identifier } from '../dist/templating.js'

describe('templating', () => {
  it('should leave plain query untouched', () => {
    expect(query`SELECT * FROM test WHERE value = $1;`).toEqual({
      query: 'SELECT * FROM test WHERE value = $1;',
      params: [],
    })

    expect(
      query`
    CREATE TABLE test (
      id SERIAL PRIMARY KEY,
      value TEXT
    );`,
    ).toEqual({
      query: `
    CREATE TABLE test (
      id SERIAL PRIMARY KEY,
      value TEXT
    );`,
      params: [],
    })
  })

  it('should parametrize templated values', () => {
    expect(query`SELECT * FROM test WHERE value = ${'foo'};`).toEqual({
      query: 'SELECT * FROM test WHERE value = $1;',
      params: ['foo'],
    })

    expect(
      query`SELECT * FROM test WHERE value = ${'foo'} AND num = ${3};`,
    ).toEqual({
      query: 'SELECT * FROM test WHERE value = $1 AND num = $2;',
      params: ['foo', 3],
    })
  })

  it('should parametrize templated values of null', () => {
    expect(query`SELECT * FROM test WHERE value = ${null};`).toEqual({
      query: 'SELECT * FROM test WHERE value = $1;',
      params: [null],
    })

    expect(
      query`SELECT * FROM test WHERE value = ${null} AND num = ${3};`,
    ).toEqual({
      query: 'SELECT * FROM test WHERE value = $1 AND num = $2;',
      params: [null, 3],
    })
  })

  it('should correctly escape identifiers', () => {
    expect(
      query`
    CREATE TABLE ${identifier`test`} (
      id SERIAL PRIMARY KEY,
      value TEXT
    );`,
    ).toEqual({
      query: `
    CREATE TABLE "test" (
      id SERIAL PRIMARY KEY,
      value TEXT
    );`,
      params: [],
    })

    expect(
      query`SELECT * FROM ${identifier`test_${2 + 3}_${'dance'}`};`,
    ).toEqual({
      query: 'SELECT * FROM "test_5_dance";',
      params: [],
    })
  })

  it('should correctly escape raw sql', () => {
    expect(
      query`SELECT * FROM test ${raw`WHERE value = ${"'foo'"} AND num = ${3}`};`,
    ).toEqual({
      query: "SELECT * FROM test WHERE value = 'foo' AND num = 3;",
      params: [],
    })

    expect(
      query`SELECT * FROM test ${raw`WHERE value = ${"'foo'"} AND num = ${3}`};`,
    ).toEqual({
      query: "SELECT * FROM test WHERE value = 'foo' AND num = 3;",
      params: [],
    })
  })

  it('should be able to nest templated statements', () => {
    const getStmt = (filterVar) =>
      query`SELECT * FROM ${identifier`test`}${filterVar !== undefined ? sql` WHERE ${identifier`foo`} = ${filterVar}` : sql``};`

    expect(getStmt('foo')).toEqual({
      query: 'SELECT * FROM "test" WHERE "foo" = $1;',
      params: ['foo'],
    })

    expect(getStmt()).toEqual({
      query: 'SELECT * FROM "test";',
      params: [],
    })
  })

  it('should parametrize without accounting for non-parameter values', () => {
    expect(
      query`SELECT * FROM ${identifier`test`} ${raw`WHERE value = ${"'foo'"}`} AND num = ${3};`,
    ).toEqual({
      query: 'SELECT * FROM "test" WHERE value = \'foo\' AND num = $1;',
      params: [3],
    })
  })
})
