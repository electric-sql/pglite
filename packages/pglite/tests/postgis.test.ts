import { describe, it, expect } from 'vitest'
import { testEsmCjsAndDTC } from './test-utils.ts'

await testEsmCjsAndDTC(async (importType, defaultDataTransferContainer) => {
  const { PGlite } =
    importType === 'esm'
      ? await import('../dist/index.js')
      : ((await import(
          '../dist/index.cjs'
        )) as unknown as typeof import('../dist/index.js'))

  const { postgis } =
    importType === 'esm'
      ? await import('../dist/postgis/index.js')
      : ((await import(
          '../dist/postgis/index.cjs'
        )) as unknown as typeof import('../dist/postgis/index.js'))

  describe(`postgis`, () => {
    it('basic', async () => {
      const pg = new PGlite({
        extensions: {
          postgis,
        },
        defaultDataTransferContainer,
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS postgis;')
      await pg.exec(`
    CREATE TABLE vehicle_location (
    time TIMESTAMPTZ NOT NULL,
    vehicle_id INT NOT NULL,
    location GEOGRAPHY(POINT, 4326)
);
  `)
      await pg.exec(`INSERT INTO vehicle_location VALUES 
  ('2023-05-29 20:00:00', 1, 'POINT(15.3672 -87.7231)'),
  ('2023-05-30 20:00:00', 1, 'POINT(15.3652 -80.7331)'),
  ('2023-05-31 20:00:00', 1, 'POINT(15.2672 -85.7431)');`)

//     const res = await pg.exec(`
//     SELECT
//       name,
//       vec,
//       vec <-> '[3,1,2]' AS distance
//     FROM test;
//   `)

//       expect(res).toMatchObject([
//         {
//           rows: [
//             {
//               name: 'test1',
//               vec: '[1,2,3]',
//               distance: 2.449489742783178,
//             },
//             {
//               name: 'test2',
//               vec: '[4,5,6]',
//               distance: 5.744562646538029,
//             },
//             {
//               name: 'test3',
//               vec: '[7,8,9]',
//               distance: 10.677078252031311,
//             },
//           ],
//           fields: [
//             {
//               name: 'name',
//               dataTypeID: 25,
//             },
//             {
//               name: 'vec',
//               dataTypeID: 16385,
//             },
//             {
//               name: 'distance',
//               dataTypeID: 701,
//             },
//           ],
//           affectedRows: 0,
//         },
//       ])
    })
  })
})
