import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { postgis } from '../src/index.js'

describe(`postgis`, () => {
  let pg: PGlite
  let dataDirArchive: File | Blob
  beforeEach(async () => {
    if (!dataDirArchive) {
      pg = await PGlite.create({
        extensions: { postgis },
      })
      dataDirArchive = await pg.dumpDataDir('gzip')
    } else {
      pg = await PGlite.create({
        extensions: { postgis },
        loadDataDir: dataDirArchive,
      })
    }
    await pg.exec('CREATE EXTENSION IF NOT EXISTS postgis;')
    // await pg.exec('CREATE EXTENSION IF NOT EXISTS postgis_raster;')
    // await pg.exec('CREATE EXTENSION IF NOT EXISTS postgis_topology;')
  })
  afterEach(async () => {
    if (!pg.closed) {
      await pg.close()
    }
  })

  it('basic', async () => {
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
  it('areas', async () => {
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

  it('ST_Polygonize', async () => {
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

  it('The coordinates in GeoJSON are not sufficiently nested', async () => {
    await expect(
      pg.exec(
        `SELECT '#3583', ST_AsText(ST_GeomFromGeoJSON('{"type":"MultiPolygon", "coordinates":[[[139.10030364990232,35.16777444430609],5842.4224490305424]]}'));`,
      ),
    ).rejects.toThrow(
      `The 'coordinates' in GeoJSON are not sufficiently nested`,
    )
  })

  it('GDAL simple', async () => {
    await pg.exec('CREATE EXTENSION IF NOT EXISTS postgis;')
    await pg.exec('CREATE EXTENSION IF NOT EXISTS postgis_raster;')
    await pg.exec('CREATE EXTENSION IF NOT EXISTS postgis_topology;')      

    await pg.exec(`
  -- enable GDAL drivers (session or DB-level)
SET postgis.gdal_enabled_drivers = 'ENABLE_ALL';

-- 1) create a temp table with a tiny 2x2 raster (3 bands)
CREATE TEMP TABLE gdal_test AS
SELECT 1 AS rid,
       ST_AddBand(
         ST_AddBand(
           ST_AddBand(
             ST_MakeEmptyRaster(2,2,0.0,0.0,1.0, -1.0, 0.0,0.0,4326),
             1, '8BUI', 10, 0
           ),
           2, '8BUI', 20, 0
         ),
         3, '8BUI', 30, 0
       ) AS rast;

-- 2) export raster to a GDAL-supported format (PNG) as bytea
WITH exported AS (
  SELECT ST_AsGDALRaster(rast, 'PNG') AS png
  FROM gdal_test
)
SELECT octet_length(png) AS png_bytes FROM exported;

-- 3) import that PNG back into a raster and inspect metadata & stats
WITH exported AS (
  SELECT ST_AsGDALRaster(rast, 'PNG') AS png
  FROM gdal_test
),
imported AS (
  SELECT ST_FromGDALRaster(png) AS rast2 FROM exported
)
SELECT
  ST_Metadata(rast2)       AS meta,
  (ST_SummaryStats(rast2,1)).* AS band1_stats,
  (ST_SummaryStats(rast2,2)).* AS band2_stats,
  (ST_SummaryStats(rast2,3)).* AS band3_stats
FROM imported;

-- 4) simple equality check: compare band means (allowing small differences)
WITH src AS (
  SELECT ST_SummaryStats(rast,1) AS s1, ST_SummaryStats(rast,2) AS s2, ST_SummaryStats(rast,3) AS s3 FROM gdal_test
),
roundtrip AS (
  SELECT (ST_SummaryStats(ST_FromGDALRaster(ST_AsGDALRaster(rast,'PNG')),1)).* AS r1,
         (ST_SummaryStats(ST_FromGDALRaster(ST_AsGDALRaster(rast,'PNG')),2)).* AS r2,
         (ST_SummaryStats(ST_FromGDALRaster(ST_AsGDALRaster(rast,'PNG')),3)).* AS r3
  FROM gdal_test
)
SELECT
  abs(src.s1.mean - roundtrip.r1.mean) < 1e-6 AS band1_mean_equal,
  abs(src.s2.mean - roundtrip.r2.mean) < 1e-6 AS band2_mean_equal,
  abs(src.s3.mean - roundtrip.r3.mean) < 1e-6 AS band3_mean_equal
FROM src, roundtrip;
`)
  })
})
