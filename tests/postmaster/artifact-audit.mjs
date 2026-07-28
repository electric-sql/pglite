#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

const [sourcePath, candidatePath, reportPath, outputPath] =
  process.argv.slice(2)
if (!outputPath) {
  throw new Error(
    'usage: postmaster-artifact-audit.mjs SOURCE CANDIDATE REPORT OUTPUT',
  )
}

const [sourceBytes, candidateBytes, report] = await Promise.all([
  readFile(sourcePath),
  readFile(candidatePath),
  readFile(reportPath, 'utf8').then(JSON.parse),
])
const [source, candidate] = await Promise.all([
  WebAssembly.compile(sourceBytes),
  WebAssembly.compile(candidateBytes),
])

const requiredExports = [
  'pgl_dispatch_pending_signals',
  'pgl_futex_wait',
  'pgl_futex_wake',
  'pgl_gettimeofday',
  'pgl_getpid',
  'pgl_kill',
  'pgl_poll',
  'pgl_set_futex_host',
  'pgl_set_clock_host',
  'pgl_set_process_host',
  'pgl_set_signal_host',
  'pgl_set_socket_host',
  'pgl_setitimer',
  'pgl_spawn_backend',
  'pgl_waitpid',
]
const sourceExports = new Set(
  WebAssembly.Module.exports(source).map(({ name }) => name),
)
const candidateExports = new Set(
  WebAssembly.Module.exports(candidate).map(({ name }) => name),
)
const candidateExportDescriptors = WebAssembly.Module.exports(candidate)
for (const name of requiredExports) {
  assert.ok(sourceExports.has(name), `source artifact is missing ${name}`)
  assert.ok(candidateExports.has(name), `candidate artifact is missing ${name}`)
}
assert.ok(candidateExports.has('__pglite_scoped_memory_keepalive'))
assert.deepEqual(
  candidateExportDescriptors.filter(({ kind }) => kind === 'memory'),
  [],
)

const memoryImports = WebAssembly.Module.imports(candidate)
  .filter(({ kind }) => kind === 'memory')
  .map(({ module, name }) => `${module}.${name}`)
assert.deepEqual(memoryImports, [
  'env.memory',
  'pglite.global_memory',
  'pglite.scoped_memory',
])
assert.equal(report.abi.pointerABI, 'pglite-tagged-i32-v1')
assert.match(report.abi.features, /atomics/)
assert.match(report.abi.features, /multimemory/)
const rewrittenOperations = Object.values(report.rewritten).reduce(
  (total, value) => total + value,
  0,
)
assert.ok(rewrittenOperations > 0)

const result = {
  schema: 1,
  status: 'pass',
  sourceSha256: sha256(sourceBytes),
  candidateSha256: sha256(candidateBytes),
  requiredExports,
  memoryImports,
  rewrittenOperations,
  sourceBytes: sourceBytes.byteLength,
  candidateBytes: candidateBytes.byteLength,
}
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`)
console.log('Postmaster artifact audit: PASS')

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
