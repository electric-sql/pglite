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

  it('areas', async () => {
    const pg = new PGlite({
      extensions: {
        postgis,
      },
      defaultDataTransferContainer,
    })
    await pg.exec('CREATE EXTENSION IF NOT EXISTS postgis;')

    const area1 = await pg.exec(`
      select ST_Area(geom) sqft,
        ST_Area(geom) * 0.3048 ^ 2 sqm
      from (
            select 'SRID=2249;POLYGON((743238 2967416,743238 2967450,
            743265 2967450,743265.625 2967416,743238 2967416))' :: geometry geom
      ) subquery;`)

    expect(area1).toEqual([
      {
        rows: [
          {
            sqft: 928.625,
            sqm: 86.27208552,
          },
        ],
        fields: [
          {
            name: 'sqft',
            dataTypeID: 701,
          },
          {
            name: 'sqm',
            dataTypeID: 701,
          },
        ],
        affectedRows: 0,
      },
    ])

    const area2 = await pg.exec(`
        select ST_Area(geom) sqft,
        ST_Area(ST_Transform(geom, 26986)) As sqm
    from (
            select
                'SRID=2249;POLYGON((743238 2967416,743238 2967450,
                743265 2967450,743265.625 2967416,743238 2967416))' :: geometry geom
        ) subquery;
  
    -- Cleanup test schema
    -- DROP SCHEMA postgis_test CASCADE;
    `)

    expect(area2).toEqual([
      {
        rows: [
          {
            sqft: 928.625,
            sqm: 86.27243061926092,
          },
        ],
        fields: [
          {
            name: 'sqft',
            dataTypeID: 701,
          },
          {
            name: 'sqm',
            dataTypeID: 701,
          },
        ],
        affectedRows: 0,
      },
    ])

    const area3 = await pg.exec(`
      select ST_Area(geog) / 0.3048 ^ 2 sqft_spheroid,
      ST_Area(geog, false) / 0.3048 ^ 2 sqft_sphere,
      ST_Area(geog) sqm_spheroid
    from (
           select ST_Transform(
                      'SRID=2249;POLYGON((743238 2967416,743238 2967450,743265 2967450,743265.625 2967416,743238 2967416))'::geometry,
                      4326
               ) :: geography geog
       ) as subquery;
      `)

    expect(area3).toEqual([
      {
        rows: [
          {
            sqft_spheroid: 928.6844047556697,
            sqft_sphere: 926.609762750544,
            sqm_spheroid: 86.27760440239217,
          },
        ],
        fields: [
          {
            name: 'sqft_spheroid',
            dataTypeID: 701,
          },
          {
            name: 'sqft_sphere',
            dataTypeID: 701,
          },
          {
            name: 'sqm_spheroid',
            dataTypeID: 701,
          },
        ],
        affectedRows: 0,
      },
    ])
  })

  it('topology', async () => {
    const pg = new PGlite({
      extensions: {
        postgis,
      },
      defaultDataTransferContainer,
    })
    await pg.exec('CREATE EXTENSION IF NOT EXISTS postgis;')
    const res = await pg.exec(`
      WITH data(geom) AS (VALUES
    ('LINESTRING (180 40, 30 20, 20 90)'::geometry)
    ,('LINESTRING (180 40, 160 160)'::geometry)
    ,('LINESTRING (80 60, 120 130, 150 80)'::geometry)
    ,('LINESTRING (80 60, 150 80)'::geometry)
    ,('LINESTRING (20 90, 70 70, 80 130)'::geometry)
    ,('LINESTRING (80 130, 160 160)'::geometry)
    ,('LINESTRING (20 90, 20 160, 70 190)'::geometry)
    ,('LINESTRING (70 190, 80 130)'::geometry)
    ,('LINESTRING (70 190, 160 160)'::geometry)
    )
    SELECT ST_AsText( ST_Polygonize( geom ))
        FROM data;
    `)

    expect(res).toEqual([
      {
        rows: [
          {
            st_astext:
              'GEOMETRYCOLLECTION(POLYGON((180 40,30 20,20 90,70 70,80 130,160 160,180 40),(150 80,120 130,80 60,150 80)),POLYGON((80 60,120 130,150 80,80 60)),POLYGON((80 130,70 70,20 90,20 160,70 190,80 130)),POLYGON((160 160,80 130,70 190,160 160)))',
          },
        ],
        fields: [
          {
            name: 'st_astext',
            dataTypeID: 25,
          },
        ],
        affectedRows: 0,
      },
    ])
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

  `)
  })
})
