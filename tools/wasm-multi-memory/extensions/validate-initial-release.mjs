#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? process.cwd())
const tooling = join(root, 'tools/wasm-multi-memory/extensions')
const inventory = readJson(join(tooling, 'wasm32-initial-inventory.json'))
const budgets = readJson(join(tooling, 'wasm32-initial-budgets.json'))
let combinedBytes = 0

for (const extension of inventory.extensions) {
  const packageRoot = join(root, extension.directory)
  const generated = readFileSync(
    join(packageRoot, 'src/generated-artifacts.ts'),
    'utf8',
  )
  assert(
    generated.includes('releaseProfile: "wasm32-initial"'),
    `${extension.name}: wrong or missing release profile`,
  )
  for (const targetKey of inventory.targets) {
    const base = `${extension.name}.${targetKey}`
    const archive = join(packageRoot, 'release', `${base}.tar.gz`)
    const descriptor = readJson(join(packageRoot, 'release', `${base}.json`))
    const bytes = readFileSync(archive)
    const hash = createHash('sha256').update(bytes).digest('hex')
    assert(descriptor.targetKey === targetKey, `${base}: wrong target key`)
    assert(
      descriptor.extensionManifest.extensionName === extension.name,
      `${base}: wrong extension name`,
    )
    assert(
      descriptor.archiveBytes === statSync(archive).size,
      `${base}: wrong archive size`,
    )
    assert(descriptor.archiveSha256 === hash, `${base}: wrong archive hash`)
    const files = descriptor.extensionManifest.files
    const expandedBytes = files.reduce((total, file) => total + file.size, 0)
    assert(
      files.length <= budgets.archive.maximumEntriesPerExtension,
      `${base}: entry-count budget exceeded`,
    )
    assert(
      expandedBytes <= budgets.archive.maximumExpandedBytesPerExtension,
      `${base}: expanded-size budget exceeded`,
    )
    assert(
      files.every(
        ({ size }) => size <= budgets.archive.maximumSingleFileBytes,
      ),
      `${base}: single-file budget exceeded`,
    )
    assert(
      descriptor.archiveBytes <=
        budgets.archive.maximumCompressedBytesPerExtension,
      `${base}: compressed-size budget exceeded`,
    )
    assert(generated.includes(targetKey), `${base}: wrapper target is missing`)
    assert(
      generated.includes(`${base}.tar.gz`),
      `${base}: wrapper asset is missing`,
    )
    combinedBytes += descriptor.archiveBytes
  }
}

assert(
  combinedBytes <= budgets.publication.maximumCombinedCompressedArtifactBytes,
  `combined compressed artifacts exceed budget: ${combinedBytes}`,
)
console.log(
  `wasm32-initial release validation: PASS (${inventory.extensions.length} extensions, ${combinedBytes} bytes)`,
)

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
