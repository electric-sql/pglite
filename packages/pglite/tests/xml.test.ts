import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGlite } from '../dist/index.js'
import * as fs from 'fs/promises'

describe('XML functionality', () => {
  let db

  beforeAll(async () => {
    await fs.rm('./pgdata-test-xml', { force: true, recursive: true })
    db = new PGlite('./pgdata-test-xml')
    await db.exec(`
      CREATE TABLE xml_test (
        id SERIAL PRIMARY KEY,
        data XML
      );
    `)
  })

  afterAll(async () => {
    await db.close()
  })

  it('should create XML documents', async () => {
    await db.exec(`
      INSERT INTO xml_test (data) VALUES
      ('<root><element>value1</element></root>'),
      ('<root><element>value2</element></root>');
    `)

    const result = await db.query('SELECT * FROM xml_test;')
    expect(result.rows).toEqual([
      { id: 1, data: '<root><element>value1</element></root>' },
      { id: 2, data: '<root><element>value2</element></root>' },
    ])
  })

  it('should use xpath to query XML documents', async () => {
    const result = await db.query(`
      SELECT xpath('/root/element/text()', data) AS elements
      FROM xml_test;
    `)

    expect(result.rows).toEqual([
      { elements: '{value1}' },
      { elements: '{value2}' },
    ])
  })

  it('should use XML aggregation', async () => {
    const result = await db.query(`
      SELECT xmlelement(name "aggregated", xmlagg(data)) AS aggregated_data
      FROM xml_test;
    `)

    expect(result.rows[0].aggregated_data).toEqual(
      '<aggregated><root><element>value1</element></root><root><element>value2</element></root></aggregated>',
    )
  })
})
