import { describe, it, expect, beforeEach } from 'vitest'
import { testDTC } from './test-utils.js'
import { PGlite } from '../dist/index.js'

function createStringOfSize(sizeInBytes: number): string {
  return 'a'.repeat(sizeInBytes)
}

const sizes = {
  '8kb': 8 * 1024,
  '5mb': 5 * 1024 * 1024,
  '12mb': 12 * 1024 * 1024,
  '128mb': 128 * 1024 * 1024,
}

const rowDataSizes = {
  '100b': 100,
  '1kb': 1024,
  '10kb': 10 * 1024,
  '100kb': 100 * 1024,
}

const rowCounts = {
  '1k rows': 1000,
  '10k rows': 10000,
  '100k rows': 100000,
}

function testEachSize(
  testFn: (sizeLabel: string, sizeInBytes: number) => Promise<void> | void,
) {
  Object.entries(sizes).forEach(([sizeLabel, sizeInBytes]) => {
    it(`handles ${sizeLabel} data size`, async () => {
      await new Promise((resolve) =>
        setTimeout(async () => {
          resolve(testFn(sizeLabel, sizeInBytes))
        }, 10),
      )
    })
  })
}

function testRowCountAndSize(
  testFn: (
    countLabel: string,
    rowCount: number,
    sizeLabel: string,
    sizeInBytes: number,
  ) => Promise<void> | void,
) {
  const countEntries = Object.entries(rowCounts)
  const sizeEntries = Object.entries(rowDataSizes)

  for (const [countLabel, rowCount] of countEntries) {
    for (const [sizeLabel, sizeInBytes] of sizeEntries) {
      if (sizeInBytes * rowCount > 1024 * 1024 * 1024) {
        // limit the size of the test to 1gb
        continue
      }
      it(`handles ${countLabel} with ${sizeLabel} per row`, async () => {
        await new Promise((resolve) =>
          setTimeout(async () => {
            // We use a timeout to ensure the console.log is flushed
            // Some of these can take a while to run
            resolve(testFn(countLabel, rowCount, sizeLabel, sizeInBytes))
          }, 10),
        )
      })
    }
  }
}

testDTC(async (defaultDataTransferContainer) => {
  describe('query and exec with different data sizes', () => {
    let db: PGlite

    beforeEach(async () => {
      db = new PGlite({ defaultDataTransferContainer, debug: 0 })

      await db.exec(`
        CREATE TABLE IF NOT EXISTS size_test (
          id SERIAL PRIMARY KEY,
          data TEXT
        );
      `)
    })

    describe('exec method', () => {
      testEachSize(async (_, sizeInBytes) => {
        const testData = createStringOfSize(sizeInBytes)

        const results = await db.exec(`
          INSERT INTO size_test (data) VALUES ('${testData}');
          SELECT * FROM size_test;
        `)

        expect(results).toHaveLength(2)
        expect(results[1].rows).toHaveLength(1)
        expect(results[1].rows[0].data).toBe(testData)
        expect(results[1].rows[0].data.length).toBe(sizeInBytes)
      })
    })

    describe('query method without params', () => {
      testEachSize(async (_, sizeInBytes) => {
        const testData = createStringOfSize(sizeInBytes)

        await db.query(`INSERT INTO size_test (data) VALUES ('${testData}');`)

        const result = await db.query<{ id: number; data: string }>(
          'SELECT * FROM size_test;',
        )

        expect(result.rows).toHaveLength(1)
        expect(result.rows[0].data).toBe(testData)
        expect(result.rows[0].data.length).toBe(sizeInBytes)
      })
    })

    describe('query method with params', () => {
      testEachSize(async (_, sizeInBytes) => {
        const testData = createStringOfSize(sizeInBytes)

        await db.query('INSERT INTO size_test (data) VALUES ($1);', [testData])

        const result = await db.query<{ id: number; data: string }>(
          'SELECT * FROM size_test WHERE data = $1;',
          [testData],
        )

        expect(result.rows).toHaveLength(1)
        expect(result.rows[0].data).toBe(testData)
        expect(result.rows[0].data.length).toBe(sizeInBytes)
      })
    })
  })

  describe('query with combinations of row counts and data sizes', () => {
    let db: PGlite

    beforeEach(async () => {
      db = new PGlite({ defaultDataTransferContainer })
    })

    testRowCountAndSize(async (_, rowCount, __, dataSize) => {
      const testData = createStringOfSize(dataSize)

      const result = await db.query<{ id: number; data: string }>(`
        SELECT generate_series(1, ${rowCount}) as id, '${testData}' as data;
      `)

      expect(result.rows).toHaveLength(rowCount)

      expect(result.rows[0].data).toBe(testData)
      expect(result.rows[0].data.length).toBe(dataSize)
      expect(result.rows[rowCount - 1].data).toBe(testData)
      expect(result.rows[rowCount - 1].data.length).toBe(dataSize)

      if (rowCount > 5) {
        const middleIndex = Math.floor(rowCount / 2)
        expect(result.rows[middleIndex].data).toBe(testData)
        expect(result.rows[middleIndex].data.length).toBe(dataSize)
      }
    })
  })

  describe('query with postgres-generated data of different sizes', () => {
    let db: PGlite

    beforeEach(async () => {
      db = new PGlite({ defaultDataTransferContainer })
    })

    testEachSize(async (_, sizeInBytes) => {
      const result = await db.query<{ id: number; data: string }>(`
        SELECT 1 as id, repeat('a', ${sizeInBytes}) as data;
      `)

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].data.length).toBe(sizeInBytes)
      expect(result.rows[0].data).toBe('a'.repeat(sizeInBytes))
    })
  })

  describe ('trigger oom', () => {

    const MB = 1024 * 1024;

    function getMemoryUsage() {
      const usage = process.memoryUsage();
      return {
        rss: Math.round(usage.rss / MB),
        heapUsed: Math.round(usage.heapUsed / MB),
        heapTotal: Math.round(usage.heapTotal / MB),
        external: Math.round(usage.external / MB),
      };
    }

    function logMemoryUsage(label: string) {
      const mem = getMemoryUsage();
      console.log(
        `[${label}] Memory: RSS=${mem.rss}MB, Heap=${mem.heapUsed}/${mem.heapTotal}MB, External=${mem.external}MB`,
      );
    }

    function generateBlob(size: number): string {
      const baseData = { padding: "x".repeat(size) };
      return JSON.stringify(baseData);
    }

    async function run() {
      logMemoryUsage("Initial");
      const db = await PGlite.create();
      logMemoryUsage("After DB init");

      await db.exec(`
        CREATE TABLE data (
          blob jsonb DEFAULT '{}'::jsonb NOT NULL
        );
      `);
      logMemoryUsage("After table creation");

      const totalRows = 10000;
      const blob = generateBlob(100000);
      console.log("\nInserting 10,000 rows with ~100KB blobs...");

      for (let row = 0; row < totalRows; row++) {
        const insertQuery = `
          INSERT INTO data (blob) 
          VALUES ('${blob}')
        `;
        await db.exec(insertQuery);
        logMemoryUsage(`After insert ${row + 1}`);
      }
    }

    run();
  })
})
