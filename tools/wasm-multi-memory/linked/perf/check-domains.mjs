import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const [stockModule, optimizedModule, runtime, workload] = process.argv.slice(2)
const compile = (path) => new WebAssembly.Module(readFileSync(path))
const provider = compile(join(runtime, 'linked-shared.wasm'))
const operators = [
  'l2_distance',
  'vector_l2_squared_distance',
  'l1_distance',
  'cosine_distance',
  'inner_product',
]
const sizes = [1, 2, 3, 255, 256, 257, 767, 768, 769, 16000]

function instantiate(path, fullGlobal = false, trace) {
  const module = compile(path)
  const native = WebAssembly.Module.imports(module).some(
    (e) => e.kind === 'memory' && e.module === 'pglite',
  )
  const heaps = [native, true, true].map((shared, index) => {
    const pages = fullGlobal && index === 1 ? 16384 : 32
    return new WebAssembly.Memory({ initial: pages, maximum: pages, shared })
  })
  const imports = {}
  for (const entry of WebAssembly.Module.imports(module)) {
    const ns = (imports[entry.module] ??= {})
    switch (entry.kind) {
      case 'function':
        ns[entry.name] = () => {
          throw new Error('unexpected import ' + entry.name)
        }
        break
      case 'global':
        ns[entry.name] = new WebAssembly.Global(
          {
            value: 'i32',
            mutable: !['__memory_base', '__table_base'].includes(entry.name),
          },
          entry.name === '__stack_pointer' ? 1024 * 1024 : 0,
        )
        break
      case 'table':
        ns[entry.name] = new WebAssembly.Table({
          initial: 1024,
          element: 'anyfunc',
        })
        break
      case 'memory':
        ns[entry.name] =
          heaps[{ memory: 0, global_memory: 1, scoped_memory: 2 }[entry.name]]
        break
    }
  }
  let value
  imports.env.pg_detoast_datum = (ptr) => ptr
  imports.env.Float8GetDatum = (float) => {
    value = float
    return 0
  }
  for (const [index, ns] of [
    [1, 'pgl_global'],
    [2, 'pgl_scoped'],
  ]) {
    imports[ns] = new WebAssembly.Instance(provider, {
      env: { memory: heaps[index] },
    }).exports
  }
  if (trace) {
    const view = new DataView(heaps[1].buffer)
    // Simulate an intervening writer after each successful global read.
    function read(ptr) {
      trace.push(ptr)
      const bits = view.getUint32(ptr, true)
      if (ptr >= 4) view.setFloat32(ptr - 4, 17.125, true)
      return bits
    }
    const lane = new DataView(new ArrayBuffer(4))
    imports.pgl_global = {
      ...imports.pgl_global,
      load_f32_4u(ptr, offset) {
        lane.setUint32(0, read((ptr >>> 0) + (offset >>> 0)), true)
        return lane.getFloat32(0, true)
      },
      load_f32_pair_ordered(a, b) {
        trace.pairs++
        return BigInt(read(a >>> 0)) | (BigInt(read(b >>> 0)) << 32n)
      },
    }
  }
  for (const name of Object.keys(imports.pgl_bulk ?? {})) {
    const [, dst, src] = /^copy([012])([012])$/.exec(name)
    imports.pgl_bulk[name] = (to, from, count) => {
      const input = new Uint8Array(heaps[src].buffer, from >>> 0, count >>> 0)
      new Uint8Array(heaps[dst].buffer).set(input, to >>> 0)
    }
  }
  const exports = new WebAssembly.Instance(module, imports).exports
  function vectors(n, left, right, rightAvailable = n, leftAvailable) {
    const fcinfo = 32000
    const args = new DataView(heaps[0].buffer)
    for (const [operand, domain] of [left, right].entries()) {
      // Put the second payload exactly at the end of its memory.
      const available = operand ? rightAvailable : (leftAvailable ?? n)
      const offset =
        operand || leftAvailable !== undefined
          ? heaps[domain].buffer.byteLength - 8 - 4 * available
          : 65536
      const view = new DataView(heaps[domain].buffer)
      view.setInt16(offset + 4, n, true)
      const next = new DataView(heaps[2].buffer)
      for (let i = 0; i < n; i++) {
        const crossesTag = fullGlobal && domain === 1 && i >= available
        if (i >= available && !crossesTag) break
        const target = crossesTag ? next : view
        target.setFloat32(
          crossesTag ? 4 * (i - available) : offset + 8 + 4 * i,
          Math.sin(0.2 + i * 0.13 + operand) * (1 + (i % 47)),
          true,
        )
      }
      const tag = [0, 0x80000000, 0xc0000000][domain]
      args.setUint32(fcinfo + 20 + operand * 8, offset | tag, true)
    }
    return Object.fromEntries(
      operators.map((name) => [
        name,
        () => {
          value = undefined
          exports[name](fcinfo)
          return value
        },
      ]),
    )
  }
  vectors.count = (left, right) => exports['heap_count_' + left + right](0)
  return vectors
}

const reference = instantiate(stockModule)
const optimized = instantiate(optimizedModule)
for (const size of sizes) {
  for (let left = 0; left < 3; left++) {
    for (let right = 0; right < 3; right++) {
      const before = reference(size, left, right)
      const after = optimized(size, left, right)
      const observed =
        workload === '--check-probe' ? optimized.count(left, right) : null
      for (const name of operators) {
        const expected = before[name]()
        assert.ok(Number.isFinite(expected))
        assert.equal(
          after[name](),
          expected,
          [name, size, left, right].join('/'),
        )
      }
      if (observed !== null)
        assert.equal(optimized.count(left, right), observed + 1)
    }
  }
}
console.log(
  'Identical results for five operators across 90 dimension and heap combinations.',
)

if (workload === '--check-mixed') {
  // OOB in a small global heap still traps on the specialized path.
  for (const build of [reference, optimized])
    assert.throws(
      build(8, 0, 1, 2).vector_l2_squared_distance,
      WebAssembly.RuntimeError,
    )
  // With a full global aperture the same tagged range continues into scoped memory.
  for (const path of [stockModule, optimizedModule]) {
    const build = instantiate(path, true)
    for (const n of [6, 7]) {
      const expected = reference(n, 0, 0)
      const crossing = build(n, 0, 1, 2)
      for (const name of operators)
        assert.equal(crossing[name](), expected[name]())
    }
  }
  console.log(
    'Global-heap bounds traps and ranges crossing into scoped memory agree.',
  )
}

if (workload === '--bench') {
  const ns = (fn) => {
    const start = performance.now()
    for (let i = 0; i < 20000; i++) fn()
    return ((performance.now() - start) * 1e6) / 20000
  }
  const median = (values) => values.toSorted((a, b) => a - b)[3]
  for (const [left, right] of [
    [0, 0],
    [0, 1],
    [1, 1],
  ]) {
    const runs = [reference(768, left, right), optimized(768, left, right)]
    for (const name of ['l2_distance', 'l1_distance', 'cosine_distance']) {
      const samples = [[], []]
      for (let i = 0; i < 9; i++) {
        for (const variant of i % 2 ? [1, 0] : [0, 1]) {
          const time = ns(runs[variant][name])
          if (i >= 2) samples[variant].push(time)
        }
      }
      console.log(
        [left, right, name, ...samples.map((s) => Math.round(median(s)))].join(
          ' ',
        ),
      )
    }
  }
}

if (workload === '--check-pairs') {
  for (const size of [2, 3, 8, 9, 255]) {
    const observations = [stockModule, optimizedModule].map((path) => {
      const trace = []
      trace.pairs = 0
      const result = instantiate(path, false, trace)(
        size,
        0,
        1,
      ).vector_l2_squared_distance()
      if (path === optimizedModule) assert.ok(trace.pairs > 0)
      return { trace: [...trace], result }
    })
    assert.equal(observations[0].trace.length, size)
    assert.deepEqual(observations[0], observations[1])
  }
  const prior = [stockModule, optimizedModule].map((path) => {
    const trace = []
    trace.pairs = 0
    const operators = instantiate(path, false, trace)(4, 0, 1, 4, 2)
    assert.throws(
      operators.vector_l2_squared_distance,
      WebAssembly.RuntimeError,
    )
    assert.equal(trace.pairs, 0)
    return [...trace]
  })
  assert.equal(prior[0].length, 2)
  assert.deepEqual(prior[1], prior[0])
  console.log(
    'Paired and scalar kernels observe identical shared-read order and values during simulated changes.',
  )
}
