import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { PGlite, defineExtension } from '@electric-sql/pglite'
import { PGlitePostmaster } from '@electric-sql/pglite/postmaster'

const [host, release] = process.argv.slice(2)
const url = pathToFileURL(release + '/probe/linked_probe.tar.gz')
const { extensionManifest: manifest, ...metadata } = JSON.parse(
  await readFile(new URL('linked_probe.json', url)),
)
const needsOrderedReads =
  manifest.processConfig.requiredHostCapabilities.includes(
    'wasm-linked-f32x8-v1',
  )
assert.equal(needsOrderedReads, host === 'previous')
const extensions = {
  probe: defineExtension({
    name: manifest.extensionName,
    backend: {
      targetKeys: [metadata.targetKey],
      artifacts: { [metadata.targetKey]: { ...metadata, manifest, url } },
    },
  }),
}
for (const engine of [PGlite, PGlitePostmaster]) {
  const dir = await mkdtemp('/tmp/linked-compat-')
  let db, cluster
  try {
    const create = () =>
      engine.create({ dataDir: pathToFileURL(dir).href, extensions })
    if (host === 'previous') {
      await assert.rejects(create(), {
        code: 'unsupported-target',
        message: /wasm-linked-f32x8-v1/,
      })
      continue
    }
    if (engine === PGlite) db = await create()
    else {
      cluster = await create()
      for (let attempt = 0; ; attempt++) {
        try {
          db = await cluster.createSession()
          break
        } catch (e) {
          if (e.code !== '57P03' || attempt >= 99) throw e
          await delay(25)
        }
      }
    }
    await db.exec('CREATE EXTENSION linked_probe')
    assert.deepEqual(
      (await db.query("SELECT linked_byte_sum(decode('017fff','hex')) AS n"))
        .rows,
      [{ n: 383 }],
    )
  } finally {
    await db?.close()
    await cluster?.close()
    await rm(dir, { recursive: true, force: true })
  }
}
console.log(
  host +
    ' host with independently built ' +
    (needsOrderedReads ? 'ordered-read' : 'v1') +
    ' probe passed on ' +
    process.version,
)
