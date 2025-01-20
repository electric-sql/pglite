import { describe, it, expect } from 'vitest'
import { PGlite } from '../dist/index.js'
import { expectToThrowAsync } from './test-utils.js'

describe('array types', () => {
  it('throws for array params enum when not calling refreshArrayTypes', async () => {
    const db = new PGlite()
    await db.query(`
          CREATE TYPE mood AS ENUM ('sad', 'happy');
        `)

    await db.query(`
          CREATE TABLE IF NOT EXISTS test (
            id SERIAL PRIMARY KEY,
            name TEXT,
            moods mood[]
          );
        `)

    await expectToThrowAsync(async () => {
      await db.query(
        `
          INSERT INTO test (name, moods) VALUES ($1, $2);
        `,
        ['test2', ['sad', 'happy']],
      )
    }, 'malformed array literal: "sad,happy"')
  })

  it('works with new array types after calling refreshArrayTypes', async () => {
    const db = new PGlite()
    await db.query(`
          CREATE TYPE mood AS ENUM ('sad', 'happy');
        `)

    await db.query(`
          CREATE TABLE IF NOT EXISTS test (
            id SERIAL PRIMARY KEY,
            name TEXT,
            moods mood[]
          );
        `)

    await db.refreshArrayTypes()

    await db.query(
      `
          INSERT INTO test (name, moods) VALUES ($1, $2);
        `,
      ['test2', ['sad', 'happy']],
    )

    const res = await db.query(`
          SELECT * FROM test;
        `)

    expect(res).toEqual({
      rows: [
        {
          id: 1,
          name: 'test2',
          moods: ['sad', 'happy'],
        },
      ],
      fields: [
        {
          name: 'id',
          dataTypeID: 23,
        },
        {
          name: 'name',
          dataTypeID: 25,
        },
        {
          name: 'moods',
          dataTypeID: 16384,
        },
      ],
      affectedRows: 0,
    })
  })

  it('refreshArrayTypes is indempotent', async () => {
    function getSize(obj) {
      return Object.keys(obj).length
    }

    const db = new PGlite()
    await db.waitReady

    const initialSerializersSize = getSize(db.serializers)
    const initialParsersSize = getSize(db.parsers)

    expect(initialSerializersSize).toBeGreaterThan(0)
    expect(initialParsersSize).toBeGreaterThan(0)

    await db.refreshArrayTypes()

    expect(getSize(db.serializers)).toBe(initialSerializersSize)
    expect(getSize(db.parsers)).toBe(initialParsersSize)

    await db.refreshArrayTypes()

    expect(getSize(db.serializers)).toBe(initialSerializersSize)
    expect(getSize(db.parsers)).toBe(initialParsersSize)
  })
})
