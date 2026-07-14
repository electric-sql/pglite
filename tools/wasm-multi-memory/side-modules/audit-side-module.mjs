#!/usr/bin/env node

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const [inputPath, outputPath, reportPath, auditPath] = process.argv.slice(2)
if (!auditPath) {
  throw new Error(
    'usage: audit-side-module.mjs INPUT OUTPUT REPORT AUDIT_OUTPUT',
  )
}

const inputBytes = readFileSync(inputPath)
const outputBytes = readFileSync(outputPath)
const input = new WebAssembly.Module(inputBytes)
const output = new WebAssembly.Module(outputBytes)
const report = JSON.parse(readFileSync(reportPath, 'utf8'))
const inputMemories = memoryImports(input)
const outputMemories = memoryImports(output)
const inputWat = disassemble(inputPath)
const outputWat = disassemble(outputPath)

assert.deepEqual(inputMemories, [
  { module: 'env', name: 'memory', kind: 'memory' },
])
assert.deepEqual(outputMemories, [
  { module: 'env', name: 'memory', kind: 'memory' },
  { module: 'pglite', name: 'global_memory', kind: 'memory' },
  { module: 'pglite', name: 'scoped_memory', kind: 'memory' },
])

const inputMemoryTypes = {
  private: memoryType(inputWat, 'env', 'memory'),
}
const outputMemoryTypes = {
  private: memoryType(outputWat, 'env', 'memory'),
  global: memoryType(outputWat, 'pglite', 'global_memory'),
  scoped: memoryType(outputWat, 'pglite', 'scoped_memory'),
}
assert.equal(inputMemoryTypes.private.shared, true)
assert.deepEqual(outputMemoryTypes, {
  private: {
    initialPages: inputMemoryTypes.private.initialPages,
    maximumPages: 32_768,
    shared: true,
  },
  global: { initialPages: 2, maximumPages: 16_384, shared: true },
  scoped: { initialPages: 2, maximumPages: 16_384, shared: true },
})

const inputDylink = WebAssembly.Module.customSections(input, 'dylink.0')
const outputDylink = WebAssembly.Module.customSections(output, 'dylink.0')
assert.equal(inputDylink.length, 1)
assert.equal(outputDylink.length, 1)
assert.deepEqual(Buffer.from(outputDylink[0]), Buffer.from(inputDylink[0]))

const sections = WebAssembly.Module.customSections(
  output,
  'pglite.multi-memory.abi',
)
assert.equal(sections.length, 1)
const manifest = JSON.parse(
  new TextDecoder('utf-8', { fatal: true }).decode(sections[0]),
)
assert.deepEqual(manifest, report.abi)
assert.equal(manifest.schema, 1)
assert.equal(manifest.tool, 'pglite-wasm-multi-memory')
assert.equal(manifest.pointerABI, 'pglite-tagged-i32-v1')
assert.equal(manifest.privateTag, 0)
assert.equal(manifest.globalTag, 2)
assert.equal(manifest.scopedTag, 3)
assert.equal(manifest.privateApertureBytes, 0x8000_0000)
assert.equal(manifest.globalApertureBytes, 0x4000_0000)
assert.equal(manifest.inputSHA256, sha256(inputBytes))
assert.ok(Object.values(report.rewritten).reduce(sum, 0) > 0)

const inputExports = WebAssembly.Module.exports(input)
  .map(({ name }) => name)
  .sort()
const outputExports = WebAssembly.Module.exports(output)
  .map(({ name }) => name)
  .filter((name) => name !== '__pglite_scoped_memory_keepalive')
  .sort()
assert.deepEqual(outputExports, inputExports)

writeFileSync(
  auditPath,
  `${JSON.stringify(
    {
      schema: 1,
      status: 'pass',
      profile: 'pglite-dynamic-side-module',
      inputSHA256: manifest.inputSHA256,
      outputSHA256: sha256(outputBytes),
      inputBytes: inputBytes.byteLength,
      outputBytes: outputBytes.byteLength,
      dylinkBytes: inputDylink[0].byteLength,
      rewrittenOperations: Object.values(report.rewritten).reduce(sum, 0),
      directPrivateOperations: Object.values(report.directPrivate).reduce(
        sum,
        0,
      ),
      helperCount: report.helpers.length,
      inputMemoryTypes,
      outputMemoryTypes,
      abi: manifest,
    },
    null,
    2,
  )}\n`,
)

console.log('PGlite dynamic side-module artifact audit: PASS')

function memoryImports(module) {
  return WebAssembly.Module.imports(module).filter(
    ({ kind }) => kind === 'memory',
  )
}

function disassemble(path) {
  return execFileSync('wasm-dis', [path, '-o', '-'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

function memoryType(wat, module, name) {
  const pattern = new RegExp(
    `\\(import "${escapeRegExp(module)}" "${escapeRegExp(name)}" ` +
      `\\(memory(?: \\$[^ )]+)? (\\d+) (\\d+) shared\\)\\)`,
  )
  const match = wat.match(pattern)
  assert.ok(match, `missing shared ${module}.${name} memory import`)
  return {
    initialPages: Number(match[1]),
    maximumPages: Number(match[2]),
    shared: true,
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function sum(total, value) {
  return total + value
}
