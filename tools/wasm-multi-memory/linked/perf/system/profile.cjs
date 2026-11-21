// Count provider calls in all PostgreSQL workers during a named SQL workload.
const {
  isMainThread,
  getEnvironmentData,
  setEnvironmentData,
} = require('node:worker_threads')
const { writeFileSync } = require('node:fs')
const phases = [
  '',
  ...['inline_payload', 'external_payload'].flatMap((t) =>
    ['heap', 'detoast', 'copy'].map((op) => t + '_' + op),
  ),
  'hnsw_search',
]
const metrics = [
  'coreScalar',
  'coreOffsetZero',
  'vectorScalar',
  'vectorOffsetZero',
  'vectorGlobalFloat',
  'bulkCalls',
  'bulkBytes',
  'bulkSmall',
  'bulkNs',
]
const key = 'pglite-system-provider-counters'
if (isMainThread)
  setEnvironmentData(
    key,
    new SharedArrayBuffer(8 * (1 + phases.length * metrics.length)),
  )
const counts = new BigInt64Array(getEnvironmentData(key))
globalThis.pglMeasurePhase = (name) => {
  const phase = phases.indexOf(name)
  if (phase < 0) throw Error(name)
  Atomics.store(counts, 0, BigInt(phase))
}
if (isMainThread)
  process.on('exit', () => {
    const profile = {}
    for (let p = 1; p < phases.length; p++)
      profile[phases[p]] = Object.fromEntries(
        metrics.map((m, i) => [m, Number(counts[1 + p * metrics.length + i])]),
      )
    writeFileSync(
      process.env.PGLITE_SYSTEM_PROFILE,
      JSON.stringify(profile, null, 2) + '\n',
    )
  })
function observe(module, imports) {
  if (!imports?.pgl_global || !imports.pgl_scoped || !imports.pgl_bulk)
    return imports
  const vector =
    module instanceof WebAssembly.Module &&
    WebAssembly.Module.exports(module).some(
      (e) => e.name === 'vector_l2_squared_distance',
    )
  const adjusted = { ...imports }
  for (const ns of ['pgl_global', 'pgl_scoped', 'pgl_bulk']) {
    adjusted[ns] = {}
    for (const [name, fn] of Object.entries(imports[ns])) {
      adjusted[ns][name] = (...args) => {
        const p = Number(Atomics.load(counts, 0))
        if (!p) return fn(...args)
        const add = (i, n = 1) =>
          Atomics.add(counts, 1 + p * metrics.length + i, BigInt(n))
        if (ns === 'pgl_bulk') {
          add(5)
          add(6, args[2] >>> 0)
          if (args[2] >>> 0 <= 32) add(7)
          const start = process.hrtime.bigint()
          try {
            return fn(...args)
          } finally {
            add(8, process.hrtime.bigint() - start)
          }
        }
        add(vector ? 2 : 0)
        if (args.at(-1) === 0) add(vector ? 3 : 1)
        if (vector && ns === 'pgl_global' && name === 'load_f32_4u') add(4)
        return fn(...args)
      }
    }
  }
  return adjusted
}
const instantiate = WebAssembly.instantiate.bind(WebAssembly)
WebAssembly.instantiate = (module, imports, ...rest) =>
  instantiate(module, observe(module, imports), ...rest)
WebAssembly.Instance = new Proxy(WebAssembly.Instance, {
  construct(Target, [module, imports]) {
    return new Target(module, observe(module, imports))
  },
})
