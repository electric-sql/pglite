#!/usr/bin/env node

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [repoRoot, wasm, glue, data] = process.argv.slice(2)
if (!data) {
  throw new Error('usage: extension-artifacts.mjs REPO_ROOT WASM GLUE DATA')
}

const importFromRepo = (path) =>
  import(pathToFileURL(join(repoRoot, path)).href)

const { PGlitePostmaster } = await importFromRepo(
  'packages/pglite/dist/postmaster/index.js',
)
const { vector } = await importFromRepo(
  'packages/pglite-pgvector/dist/index.js',
)
const { postgis } = await importFromRepo(
  'packages/pglite-postgis/dist/index.js',
)

const dataDirectory = await mkdtemp(
  join(tmpdir(), 'pglite-extension-artifacts-'),
)
const startupBudgetMilliseconds = 15_000
const configurationBudgetMilliseconds = 50
const linkedBytesBudget = 32 * 1024 * 1024

try {
  await withPostmaster(async (postmaster) => {
    assert.equal(postmaster.runtimeTarget.topology, 'multi-memory')
    assert.equal(postmaster.runtimeTarget.pointerWidth, 32)

    const [sessionA, sessionB] = await Promise.all([
      postmaster.createSession(),
      postmaster.createSession(),
    ])
    try {
      await sessionA.exec('CREATE EXTENSION vector; CREATE EXTENSION postgis;')
      const [{ rows: vectorRows }, { rows: postgisRows }] = await Promise.all([
        sessionA.query(
          "SELECT '[1,2,3]'::vector <-> '[3,2,1]'::vector AS distance",
        ),
        sessionB.query(
          'SELECT ST_AsText(ST_Transform(ST_SetSRID(ST_Point(-0.1, 51.5), 4326), 3857)) AS point',
        ),
      ])
      assert.ok(vectorRows[0].distance > 0)
      assert.match(postgisRows[0].point, /^POINT\(/)
      await sessionA.exec('CREATE EXTENSION postgis_raster')
      await Promise.all([
        assertRasterRoundtrip(sessionA),
        assertRasterRoundtrip(sessionB),
      ])
    } finally {
      await Promise.all([sessionA.close(), sessionB.close()])
    }
  })

  await withPostmaster(async (postmaster) => {
    const session = await postmaster.createSession()
    try {
      const { rows } = await session.query(
        "SELECT extname FROM pg_extension WHERE extname IN ('vector', 'postgis', 'postgis_raster') ORDER BY extname",
      )
      assert.deepEqual(rows, [
        { extname: 'postgis' },
        { extname: 'postgis_raster' },
        { extname: 'vector' },
      ])
      const query = await session.query(
        "SELECT '[1,0,0]'::vector <-> '[0,1,0]'::vector AS distance",
      )
      assert.ok(query.rows[0].distance > 0)
      await assertRasterRoundtrip(session)
    } finally {
      await session.close()
    }
  })

  console.log('wasm32-initial postmaster extensions: PASS')
} finally {
  await rm(dataDirectory, { recursive: true, force: true })
}

async function assertRasterRoundtrip(session) {
  await session.exec("SET postgis.gdal_enabled_drivers = 'ENABLE_ALL'")
  for (let attempt = 0; attempt < 2; attempt++) {
    const png = await session.query(`
      WITH encoded AS MATERIALIZED (
        SELECT ST_AsGDALRaster(ST_AddBand(
          ST_MakeEmptyRaster(1, 1, 0, 0, 1, -1, 0, 0, 4326),
          1, '8BUI', 7, 0
        ), 'PNG') AS data
      )
      SELECT encode(substring(data FOR 8), 'hex') AS signature,
        (ST_SummaryStats(ST_FromGDALRaster(data), 1)).mean AS mean
      FROM encoded
    `)
    assert.deepEqual(png.rows, [{ signature: '89504e470d0a1a0a', mean: 7 }])
  }
}

async function withPostmaster(run) {
  const started = performance.now()
  const postmaster = await PGlitePostmaster.create({
    dataDir: `file://${dataDirectory}`,
    maxConnections: 8,
    sharedBuffers: '16MB',
    artifact: { wasm, glue, data },
    extensions: { vector, postgis },
  })
  try {
    const startupMilliseconds = performance.now() - started
    const diagnostics = postmaster.diagnostics()
    assert.ok(
      startupMilliseconds <= startupBudgetMilliseconds,
      `cold startup ${startupMilliseconds}ms exceeds ${startupBudgetMilliseconds}ms`,
    )
    assert.ok(
      diagnostics.extensionConfigurationMilliseconds <=
        configurationBudgetMilliseconds,
      `extension configuration ${diagnostics.extensionConfigurationMilliseconds}ms exceeds ${configurationBudgetMilliseconds}ms`,
    )
    assert.ok(
      diagnostics.maximumExtensionLinkedDataBytesPerProcess <=
        linkedBytesBudget,
      `incremental per-process extension linking ${diagnostics.maximumExtensionLinkedDataBytesPerProcess} bytes exceeds the ${linkedBytesBudget}-byte budget`,
    )
    await run(postmaster)
  } finally {
    await postmaster.close()
  }
}
