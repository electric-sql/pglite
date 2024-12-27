import { tests } from './base.js'

tests('node', './pgdata-test', 'node.fs')

describe('COPY command affectedRows', () => {
  let db

  beforeAll(async () => {
    db = new PGlite('./pgdata-test-copy')
    await db.waitReady
    await db.query(`
      CREATE TABLE IF NOT EXISTS test_copy (
        id SERIAL PRIMARY KEY,
        name TEXT
      );
    `)
  })

  afterAll(async () => {
    await db.close()
  })

  it('should return affectedRows for COPY command', async () => {
    const csvData = '1,test1\n2,test2\n'
    const blob = new Blob([csvData])

    const copyResult = await db.query("COPY test_copy FROM '/dev/blob' WITH (FORMAT csv);", [], {
      blob,
    })

    expect(copyResult).toMatchObject({
      affectedRows: 2,
    })
  })
})
