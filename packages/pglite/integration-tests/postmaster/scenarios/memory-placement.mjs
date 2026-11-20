#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'

const [repoRoot, wasm, glue, data, globalModule, rootModule, output] =
  process.argv.slice(2)
if (!output)
  throw new Error(
    'usage: memory-placement.mjs ROOT WASM GLUE DATA GLOBAL_MODULE ROOT_MODULE OUTPUT',
  )
const { PGlitePostmaster } = await import(
  pathToFileURL(join(repoRoot, 'packages/pglite/dist/postmaster/index.js')).href
)
const artifact = { wasm, glue, data }
const pairCount = 5
const repetitions = { basic: 100, resowners: 20 }
const cases = []
for (let pair = 0; pair < pairCount; pair++) {
  for (const mode of pair % 2 === 0 ? ['global', 'root'] : ['root', 'global']) {
    cases.push(await measure(mode, pair))
  }
}
const errors = []
for (const maximum of [128 * 1024, 8 * 1024 * 1024])
  errors.push(await checkErrors(maximum))
const ratios = Array.from({ length: pairCount }, (_, pair) => {
  const global = cases.find(
    (entry) => entry.pair === pair && entry.mode === 'global',
  )
  const root = cases.find(
    (entry) => entry.pair === pair && entry.mode === 'root',
  )
  assert.ok(root.warm.scopedMemoryBytes > root.before.scopedMemoryBytes)
  assert.ok(global.warm.globalMemoryBytes > global.before.globalMemoryBytes)
  assert.ok(
    root.warm.globalMemoryBytes - root.before.globalMemoryBytes <
      global.warm.globalMemoryBytes - global.before.globalMemoryBytes,
  )
  return Object.fromEntries(
    Object.keys(repetitions).map((kind) => [
      kind,
      root.timings[kind] / global.timings[kind],
    ]),
  )
})
const source = await readFile(
  join(repoRoot, 'postgres-pglite/src/test/modules/test_dsa/test_dsa.c'),
)
await writeFile(
  output,
  `${JSON.stringify(
    {
      status: 'pass',
      sourceSha256: createHash('sha256').update(source).digest('hex'),
      pairCount,
      repetitions,
      cases,
      errors,
      pairRatios: ratios,
      medianRatios: Object.fromEntries(
        Object.keys(repetitions).map((kind) => [
          kind,
          median(ratios.map((ratio) => ratio[kind])),
        ]),
      ),
    },
    null,
    2,
  )}\n`,
)
console.log(
  'Reviewed compiler placement, memory reuse, and paired timings: PASS',
)

async function measure(mode, pair) {
  const instance = await start()
  const { postmaster, session } = instance
  try {
    await install(instance, mode)
    const pid = (await session.query('SELECT pg_backend_pid() AS pid')).rows[0]
      .pid
    const before = postmaster.diagnostics()
    for (const [kind, count] of [
      ['basic', 10],
      ['resowners', 3],
    ]) {
      await session.query(
        `SELECT placement_${kind}() FROM generate_series(1, ${count})`,
      )
    }
    const warm = postmaster.diagnostics()
    const timings = {}
    for (const [kind, count] of Object.entries(repetitions)) {
      const began = performance.now()
      await session.query(
        `SELECT placement_${kind}() FROM generate_series(1, ${count})`,
      )
      timings[kind] = performance.now() - began
    }
    const after = postmaster.diagnostics()
    assert.equal(
      after.scopedLifetime.allocatedBytes,
      before.scopedLifetime.allocatedBytes,
    )
    assert.equal(
      after.scopedMemoryBytes,
      warm.scopedMemoryBytes,
      'root backing grew after warmup',
    )
    assert.equal(
      after.globalMemoryBytes,
      warm.globalMemoryBytes,
      'global backing grew after warmup',
    )
    if (mode === 'root')
      assert.ok(
        after.scopedLifetime.allocationGeneration >
          warm.scopedLifetime.allocationGeneration,
      )
    await session.close()
    await waitFor(
      () => !postmaster.registry.handles().some((handle) => handle.pid === pid),
    )
    const closed = postmaster.diagnostics()
    if (mode === 'root') {
      assert.ok(
        after.scopedMemoryBytes - closed.scopedMemoryBytes > 1024 * 1024,
        'backend exit retained its DSA backing store',
      )
    } else {
      assert.equal(closed.globalMemoryBytes, warm.globalMemoryBytes)
    }
    return { mode, pair, before, warm, after, closed, timings }
  } finally {
    await dispose(instance)
  }
}

async function checkErrors(scopedMaximumMemory) {
  const instance = await start({ scopedMaximumMemory })
  const { postmaster, session } = instance
  try {
    await install(instance, 'root')
    await install(instance, 'global', 'control_')
    const failedFunction =
      scopedMaximumMemory < 1024 * 1024 ? 'basic' : 'resowners'
    for (let attempt = 0; attempt < 4; attempt++) {
      await session.exec('BEGIN; SAVEPOINT placement_error')
      await assert.rejects(
        session.query(`SELECT placement_${failedFunction}()`),
        /could not get shared memory segment: Out of memory/,
      )
      await session.exec('ROLLBACK TO SAVEPOINT placement_error; COMMIT')
      assert.equal(postmaster.diagnostics().scopedLifetime.allocatedBytes, 0)
      await session.query('SELECT control_basic()')
    }
    return {
      scopedMaximumMemory,
      failedFunction,
      diagnostics: postmaster.diagnostics(),
    }
  } finally {
    await dispose(instance)
  }
}

async function start(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'pglite-placement-'))
  let postmaster
  try {
    postmaster = await PGlitePostmaster.create({
      dataDir: `file://${directory}`,
      maxConnections: 4,
      sharedBuffers: '16MB',
      artifact,
      ...options,
    })
    let session
    const deadline = Date.now() + 60_000
    while (!session) {
      try {
        session = await postmaster.createSession()
      } catch (error) {
        if (error?.code !== '57P03' || Date.now() > deadline) throw error
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    return { directory, postmaster, session }
  } catch (error) {
    await postmaster?.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

async function install({ directory, session }, mode, prefix = 'placement_') {
  const library = `placement_${mode}.so`
  await copyFile(
    mode === 'root' ? rootModule : globalModule,
    join(directory, library),
  )
  for (const kind of Object.keys(repetitions)) {
    await session.query(`CREATE FUNCTION ${prefix}${kind}() RETURNS void
      AS '/pglite/data/${library}', 'pgl_placement_${mode}_${kind}' LANGUAGE C`)
  }
}

async function dispose({ directory, postmaster, session }) {
  await session.close().catch(() => undefined)
  await postmaster.close()
  const diagnostics = postmaster.diagnostics()
  assert.equal(diagnostics.livePrivateMemories, 0)
  assert.equal(diagnostics.liveScopedMemories, 0)
  await rm(directory, { recursive: true, force: true })
}

async function waitFor(predicate) {
  const deadline = Date.now() + 10_000
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error('backend did not release its memory')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

function median(values) {
  return [...values].sort((left, right) => left - right)[
    Math.floor(values.length / 2)
  ]
}
