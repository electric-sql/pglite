import test from 'ava'
import { PGlite } from '../../dist/index.js'
import { cube } from '../../dist/contrib/cube.js'
import { earthdistance } from '../../dist/contrib/earthdistance.js'

test('earthdistance', async (t) => {
  const pg = new PGlite({
    extensions: {
      cube,
      earthdistance,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS cube;')
  await pg.exec('CREATE EXTENSION IF NOT EXISTS earthdistance;')

  await pg.exec(`
    CREATE TABLE locations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100),
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION
    );
  `)

  await pg.exec(`
    INSERT INTO locations (name, latitude, longitude)
    VALUES
      ('Location A', 40.7128, -74.0060),  -- New York City (nearby point)
      ('Location B', 40.730610, -73.935242),  -- Another point in NYC
      ('Location C', 34.052235, -118.243683),  -- Los Angeles (far away)
      ('Location D', 40.758896, -73.985130),  -- Times Square, NYC
      ('Location E', 51.507351, -0.127758);  -- London (far away)
  `)

  const res = await pg.query(`
    SELECT
      name,
      earth_distance(
        ll_to_earth(40.7128, -74.0060),
        ll_to_earth(latitude, longitude)
      ) AS distance
    FROM locations
    ORDER BY distance;
  `)

  t.deepEqual(res.rows, [
    { name: 'Location A', distance: 0 },
    { name: 'Location D', distance: 5424.971028170555 },
    { name: 'Location B', distance: 6290.327117342975 },
    { name: 'Location C', distance: 3940171.3340000752 },
    { name: 'Location E', distance: 5576493.70395964 },
  ])
})
