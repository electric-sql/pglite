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
      const inserted = await pg.query(`INSERT INTO vehicle_location VALUES 
  ('2023-05-29 20:00:00', 1, 'POINT(15.3672 -87.7231)'),
  ('2023-05-30 20:00:00', 1, 'POINT(15.3652 -80.7331)'),
  ('2023-05-31 20:00:00', 1, 'POINT(15.2672 -85.7431)');`)

      expect(inserted.affectedRows).toEqual(3)
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
        const inserted = await pg.query(`INSERT INTO cities (name, location)
VALUES
    ('New York', ST_GeomFromText('POINT(-74.0060 40.7128)', 4326)),
    ('Los Angeles', ST_GeomFromText('POINT(-118.2437 34.0522)', 4326)),
    ('Chicago', ST_GeomFromText('POINT(-87.6298 41.8781)', 4326));`)

        expect(inserted.affectedRows).toEqual(3)

        const cities = await pg.query(`WITH state_boundary AS (
    SELECT ST_GeomFromText(
        'POLYGON((-91 36, -91 43, -87 43, -87 36, -91 36))', 4326
    ) AS geom
)
SELECT c.name
FROM cities c, state_boundary s
WHERE ST_Within(c.location, s.geom);`)

        expect(cities.affectedRows).toBe(0)
        expect(cities.rows[0]).toEqual({
          name: 'Chicago',
        })
      })
  })
  it('complex1', async () => {
    const pg = new PGlite({
      extensions: {
        postgis,
      },
      defaultDataTransferContainer,
    })
    await pg.exec('CREATE EXTENSION IF NOT EXISTS postgis;')

    await pg.exec(`
    -- Create test schema
  -- CREATE SCHEMA IF NOT EXISTS postgis_test;
  -- SET search_path TO postgis_test;

  -- Create a table with geometry columns
  CREATE TABLE cities (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      population INTEGER,
      geom GEOMETRY(Point, 4326)
  );`)

    await pg.exec(`
  CREATE TABLE rivers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      geom GEOMETRY(LineString, 4326)
  );

  -- Insert sample data
  INSERT INTO cities (name, population, geom) VALUES
  ('Paris', 2148000, ST_SetSRID(ST_MakePoint(2.3522, 48.8566), 4326)),
  ('Berlin', 3769000, ST_SetSRID(ST_MakePoint(13.4050, 52.5200), 4326)),
  ('London', 8982000, ST_SetSRID(ST_MakePoint(-0.1276, 51.5072), 4326)),
  ('Amsterdam', 872757, ST_SetSRID(ST_MakePoint(4.9041, 52.3676), 4326));

  INSERT INTO rivers (name, geom) VALUES
  ('Seine', ST_SetSRID(ST_MakeLine(ARRAY[
      ST_MakePoint(2.1, 48.8),
      ST_MakePoint(2.35, 48.85),
      ST_MakePoint(2.45, 48.9)
  ]), 4326)),
  ('Spree', ST_SetSRID(ST_MakeLine(ARRAY[
      ST_MakePoint(13.1, 52.4),
      ST_MakePoint(13.35, 52.5),
      ST_MakePoint(13.45, 52.52)
  ]), 4326));

  -- Create spatial index
  CREATE INDEX idx_cities_geom ON cities USING GIST (geom);
  CREATE INDEX idx_rivers_geom ON rivers USING GIST (geom);

  -- Query: Find cities within 10 km of any river
  SELECT
      c.name AS city,
      r.name AS river,
      ST_Distance(c.geom::geography, r.geom::geography) AS distance_km
  FROM cities c
  JOIN rivers r
  ON ST_DWithin(c.geom::geography, r.geom::geography, 10000)
  ORDER BY distance_km;

  -- Query: Compute buffered area around each river and intersecting cities
  SELECT
      r.name AS river_name,
      COUNT(c.id) AS num_cities_intersecting,
      ST_Area(ST_Transform(ST_Buffer(r.geom::geography, 5000), 3857)) / 1e6 AS buffer_area_sqkm
  FROM rivers r
  LEFT JOIN cities c
  ON ST_Intersects(ST_Buffer(r.geom::geography, 5000), c.geom)
  GROUP BY r.name;

  -- Cleanup test schema
  -- DROP SCHEMA postgis_test CASCADE;
  `)
  })
})
