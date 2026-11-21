import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { defineExtension } from '@electric-sql/pglite'
import { postgis } from '@electric-sql/pglite-postgis'

const path = new URL('./linked_probe.tar.gz', import.meta.url)
const { extensionManifest: manifest, ...metadata } = JSON.parse(
  await readFile(new URL('./linked_probe.json', path)),
)
export const extraExtensions = {
  postgis,
  linked_probe: defineExtension({
    name: 'linked_probe',
    backend: {
      targetKeys: [metadata.targetKey],
      artifacts: { [metadata.targetKey]: { ...metadata, manifest, url: path } },
    },
  }),
}

export async function checkExtraExtensions(writer, reader = writer) {
  assert.deepEqual(postgis.backend.targetKeys, ['wasm32-faceted'])
  await writer.exec(
    'CREATE EXTENSION linked_probe; CREATE EXTENSION postgis; CREATE EXTENSION postgis_raster; CREATE EXTENSION postgis_topology;',
  )
  // The reader's first PostGIS call resolves the base library through the raster dependency.
  const version = await reader.query('SELECT postgis_raster_lib_version() AS v')
  assert.match(version.rows[0].v, /^\d+\./)
  const coordinate = await reader.query(
    `SELECT ST_X(p) AS x, ST_Y(p) AS y FROM (SELECT ST_Transform(ST_SetSRID(ST_Point(-0.1,51.5),4326),3857) AS p) s`,
  )
  assert.ok(Math.abs(coordinate.rows[0].x + 11131.95) < 0.1)
  assert.ok(Math.abs(coordinate.rows[0].y - 6710219.08) < 0.1)
  for (const session of new Set([writer, reader])) {
    assert.deepEqual(
      (
        await session.query(
          "SELECT linked_byte_sum(decode('007fff', 'hex')) AS n",
        )
      ).rows,
      [{ n: 382 }],
    )
    await session.exec("SET postgis.gdal_enabled_drivers='ENABLE_ALL'")
    const raster = await session.query(`WITH encoded AS MATERIALIZED (
      SELECT ST_AsGDALRaster(ST_AddBand(ST_MakeEmptyRaster(1,1,0,0,1,-1,0,0,4326),1,'8BUI',7,0),'PNG') AS data)
      SELECT encode(substring(data FOR 8),'hex') AS signature,
             (ST_SummaryStats(ST_FromGDALRaster(data),1)).mean AS mean FROM encoded`)
    assert.deepEqual(raster.rows, [{ signature: '89504e470d0a1a0a', mean: 7 }])
  }
  const topology = await writer.query(
    "SELECT topology.CreateTopology('test_topo',4326) > 0 AS created",
  )
  assert.deepEqual(topology.rows, [{ created: true }])
  await writer.exec(`CREATE TABLE places AS SELECT i, ST_Point(i, i) AS point FROM generate_series(1,1000) i;
    CREATE INDEX places_gist ON places USING gist(point); ANALYZE places`)
  const query =
    'SELECT i FROM places WHERE ST_Intersects(point,ST_MakeEnvelope(99.9,99.9,100.1,100.1))'
  const plan = await reader.query('EXPLAIN (COSTS OFF) ' + query)
  assert.match(JSON.stringify(plan.rows), /places_gist/)
  assert.deepEqual((await reader.query(query)).rows, [{ i: 100 }])
}
