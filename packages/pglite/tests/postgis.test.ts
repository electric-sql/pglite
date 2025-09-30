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


    }),
    it('cities', async () => {
      const pg = new PGlite({
        extensions: {
          postgis,
        },
        defaultDataTransferContainer,
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS postgis;')
      await pg.exec(`
    CREATE TABLE cities (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    location GEOMETRY(Point, 4326)
);
  `)
      await pg.exec(`INSERT INTO cities (name, location)
VALUES
    ('New York', ST_GeomFromText('POINT(-74.0060 40.7128)', 4326)),
    ('Los Angeles', ST_GeomFromText('POINT(-118.2437 34.0522)', 4326)),
    ('Chicago', ST_GeomFromText('POINT(-87.6298 41.8781)', 4326));`)

    await pg.exec(`WITH state_boundary AS (
    SELECT ST_GeomFromText(
        'POLYGON((-91 36, -91 43, -87 43, -87 36, -91 36))', 4326
    ) AS geom
)
SELECT c.name
FROM cities c, state_boundary s
WHERE ST_Within(c.location, s.geom);`)

    })
  })
})
