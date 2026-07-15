#!/usr/bin/env node

import assert from 'node:assert/strict'
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
const inputMemoryImports = memoryImportTypes(inputBytes)
const outputMemoryImports = memoryImportTypes(outputBytes)

assert.deepEqual(inputMemories, [
  { module: 'env', name: 'memory', kind: 'memory' },
])
assert.deepEqual(outputMemories, [
  { module: 'env', name: 'memory', kind: 'memory' },
  { module: 'pglite', name: 'global_memory', kind: 'memory' },
  { module: 'pglite', name: 'scoped_memory', kind: 'memory' },
])

const inputMemoryTypes = {
  private: memoryType(inputMemoryImports, 'env', 'memory'),
}
const outputMemoryTypes = {
  private: memoryType(outputMemoryImports, 'env', 'memory'),
  global: memoryType(outputMemoryImports, 'pglite', 'global_memory'),
  scoped: memoryType(outputMemoryImports, 'pglite', 'scoped_memory'),
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
const rewrittenOperations = Object.values(report.rewritten).reduce(sum, 0)
assert.ok(Number.isSafeInteger(rewrittenOperations))
assert.ok(rewrittenOperations >= 0)

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
      rewrittenOperations,
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

function memoryType(imports, module, name) {
  const type = imports.get(`${module}\0${name}`)
  assert.ok(type, `missing ${module}.${name} memory import`)
  return type
}

// Read only the import section instead of disassembling the whole module to
// WAT. Large extension modules (notably PostGIS) produce WAT larger than
// Node's child-process buffers, while the information audited here occupies
// only a few bytes in the Wasm binary.
function memoryImportTypes(bytes) {
  const reader = binaryReader(bytes)
  assert.deepEqual([...reader.bytes(8)], [0, 97, 115, 109, 1, 0, 0, 0])

  const memories = new Map()
  while (!reader.done()) {
    const sectionId = reader.byte()
    const section = binaryReader(reader.bytes(reader.uleb()))
    if (sectionId !== 2) continue

    const count = section.uleb()
    for (let index = 0; index < count; index++) {
      const module = section.string()
      const name = section.string()
      const kind = section.byte()
      switch (kind) {
        case 0: // function type index
          section.uleb()
          break
        case 1: // table type
          section.byte()
          readLimits(section)
          break
        case 2: // memory type
          memories.set(`${module}\0${name}`, readLimits(section))
          break
        case 3: // global type
          section.byte()
          section.byte()
          break
        case 4: // tag type
          section.uleb()
          section.uleb()
          break
        default:
          throw new Error(`unsupported Wasm import kind ${kind}`)
      }
    }
    assert.equal(section.done(), true, 'trailing bytes in Wasm import section')
    return memories
  }
  return memories
}

function readLimits(reader) {
  const flags = reader.uleb()
  const hasMaximum = (flags & 1) !== 0
  const shared = (flags & 2) !== 0
  const memory64 = (flags & 4) !== 0
  const initialPages = reader.uleb()
  const maximumPages = hasMaximum ? reader.uleb() : undefined
  assert.equal(memory64, false, 'memory64 imports are outside wasm32-initial')
  return { initialPages, maximumPages, shared }
}

function binaryReader(bytes) {
  let offset = 0
  const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    byte() {
      assert.ok(offset < view.length, 'unexpected end of Wasm binary')
      return view[offset++]
    },
    bytes(length) {
      assert.ok(offset + length <= view.length, 'truncated Wasm binary')
      const result = view.subarray(offset, offset + length)
      offset += length
      return result
    },
    uleb() {
      let result = 0
      let shift = 0
      while (true) {
        const byte = this.byte()
        result += (byte & 0x7f) * 2 ** shift
        assert.ok(Number.isSafeInteger(result), 'Wasm integer exceeds JS range')
        if ((byte & 0x80) === 0) return result
        shift += 7
        assert.ok(shift < 56, 'invalid Wasm unsigned LEB128')
      }
    },
    string() {
      return new TextDecoder('utf-8', { fatal: true }).decode(
        this.bytes(this.uleb()),
      )
    },
    done() {
      return offset === view.length
    },
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function sum(total, value) {
  return total + value
}
