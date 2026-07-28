import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'vitest'
import { artifact } from './support/artifacts.js'

describe('transformer artifacts', () => {
  it('preserves metadata and reports every transformed operation', async () => {
    const [
      inputBytes,
      outputBytes,
      inventory,
      report,
      inputMap,
      outputMap,
      sourceInputMap,
      sourceOutputMap,
    ] = await Promise.all([
      readFile(artifact('opcodes.wasm')),
      readFile(artifact('opcodes.multi.wasm')),
      readFile(artifact('opcodes.wat.inventory.json'), 'utf8').then(JSON.parse),
      readFile(artifact('report.json'), 'utf8').then(JSON.parse),
      readFile(artifact('opcodes.wasm.map'), 'utf8').then(JSON.parse),
      readFile(artifact('opcodes.multi.wasm.map'), 'utf8').then(JSON.parse),
      readFile(artifact('source-map.wasm.map'), 'utf8').then(JSON.parse),
      readFile(artifact('source-map.multi.wasm.map'), 'utf8').then(JSON.parse),
    ])

    const rewrittenKinds = [
      'load',
      'store',
      'atomic-load',
      'atomic-store',
      'atomic-rmw',
      'atomic-cmpxchg',
      'atomic-wait',
      'atomic-notify',
      'simd-load',
      'simd-lane-load',
      'simd-lane-store',
      'memory-copy',
      'memory-fill',
    ]
    const allowlistMap = {
      'memory-init': 'memory-init-private',
      'memory-size': 'memory-size-private',
      'memory-grow': 'memory-grow-private',
      'atomic-fence': 'atomic-fence',
      'data-drop': 'data-drop',
    }
    for (const kind of rewrittenKinds) {
      assert.equal(
        report.rewritten[kind],
        inventory[kind],
        `rewrite count for ${kind}`,
      )
    }
    for (const [fixtureKind, reportKind] of Object.entries(allowlistMap)) {
      assert.equal(
        report.allowlisted[reportKind],
        inventory[fixtureKind],
        `allowlist count for ${fixtureKind}`,
      )
    }
    assert.equal(report.abi.helperCount, report.helpers.length)
    assert.equal(
      new Set(report.helpers.map(({ name }) => name)).size,
      report.helpers.length,
    )
    assert.match(report.abi.inputSHA256, /^[0-9a-f]{64}$/)
    assert.equal(report.abi.privateApertureBytes, 0x80000000)
    assert.equal(report.abi.globalApertureBytes, 0x40000000)
    assert.equal(report.abi.scopedMemory, '__pglite_scoped_memory')
    assert.match(report.abi.features, /multimemory/)
    assert.ok(report.abi.featureBits > 0)
    const input = new WebAssembly.Module(inputBytes)
    const output = new WebAssembly.Module(outputBytes)
    assert.equal(WebAssembly.Module.customSections(input, 'name').length, 1)
    assert.equal(WebAssembly.Module.customSections(output, 'name').length, 1)
    const abiSections = WebAssembly.Module.customSections(
      output,
      'pglite.multi-memory.abi',
    )
    assert.equal(abiSections.length, 1)
    const embeddedABI = JSON.parse(new TextDecoder().decode(abiSections[0]))
    assert.deepEqual(embeddedABI, report.abi)
    const sourceMapURLs = WebAssembly.Module.customSections(
      output,
      'sourceMappingURL',
    )
    assert.equal(sourceMapURLs.length, 1)
    assert.ok(
      new TextDecoder()
        .decode(sourceMapURLs[0])
        .endsWith('opcodes.multi.wasm.map'),
    )
    assert.deepEqual(
      WebAssembly.Module.imports(output)
        .filter(({ kind }) => kind === 'memory')
        .map(({ module, name }) => [module, name]),
      [
        ['env', 'memory'],
        ['pglite', 'global_memory'],
        ['pglite', 'scoped_memory'],
      ],
    )
    const outputExports = WebAssembly.Module.exports(output)
    assert.deepEqual(
      outputExports.filter(({ kind }) => kind === 'memory'),
      [],
      'the reserved scoped import is retained without an Emscripten-incompatible memory export',
    )
    assert.ok(
      outputExports.some(
        ({ kind, name }) =>
          kind === 'function' && name === '__pglite_scoped_memory_keepalive',
      ),
    )

    assert.deepEqual(outputMap.sources, inputMap.sources)
    assert.equal(
      outputMap.mappings,
      inputMap.mappings,
      'replacement calls retain all original source-map locations',
    )
    assert.deepEqual(sourceOutputMap.sources, sourceInputMap.sources)
    assert.ok(
      sourceOutputMap.sources.some((source) =>
        source.endsWith('/source-map.c'),
      ),
    )
    assert.ok(sourceInputMap.mappings.length > 0)
    assert.ok(sourceOutputMap.mappings.length > 0)
  })

  it('produces byte-for-byte deterministic Wasm, source maps, and reports', async () => {
    for (const [first, second] of [
      ['opcodes.multi.wasm', 'opcodes.multi.repeat.wasm'],
      ['opcodes.multi.wasm.map', 'opcodes.multi.repeat.wasm.map'],
      ['report.json', 'report.repeat.json'],
    ]) {
      assert.deepEqual(
        await readFile(artifact(first)),
        await readFile(artifact(second)),
      )
    }
  })
})
