#!/usr/bin/env node

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const [repoRootArg, outArg, target, statusText] = process.argv.slice(2)
if (statusText === undefined) {
  throw new Error(
    'usage: summarize-postgres-tests.mjs REPO_ROOT OUT TARGET STATUS',
  )
}
const repoRoot = resolve(repoRootArg)
const out = resolve(outArg)
const status = Number.parseInt(statusText, 10)
const provider = join(out, 'provider')
const clusterDirectory = join(out, `results/raw-${target}/clusters`)
let clusterFiles = []
try {
  clusterFiles = (await readdir(clusterDirectory)).filter((name) =>
    name.endsWith('.json'),
  )
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}
const clusters = await Promise.all(
  clusterFiles.map(async (name) =>
    JSON.parse(await readFile(join(clusterDirectory, name), 'utf8')),
  ),
)
const capabilities = JSON.parse(
  await readFile(join(provider, 'capabilities.json'), 'utf8'),
)
const config = JSON.parse(await readFile(join(provider, 'config.json'), 'utf8'))
let capabilityEventFiles = []
try {
  capabilityEventFiles = (await readdir(config.capabilityEvents)).filter(
    (name) => name.endsWith('.json'),
  )
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}
const capabilityEvents = await Promise.all(
  capabilityEventFiles.map(async (name) =>
    JSON.parse(await readFile(join(config.capabilityEvents, name), 'utf8')),
  ),
)
for (const event of capabilityEvents) {
  if (event.postgresRevision !== config.postgresRevision) {
    throw new Error(`stale capability event for ${event.path}`)
  }
}
if (target === 'check-world' && capabilityEvents.length === 0) {
  throw new Error('check-world produced no capability events')
}
const capabilityCounts = Object.values(capabilities.capabilities).reduce(
  (counts, capability) => {
    counts[capability.state] = (counts[capability.state] ?? 0) + 1
    return counts
  },
  { SUPPORTED: 0, UNSUPPORTED: 0, BLOCKED: 0 },
)
const suiteRuleCounts = capabilities.testPolicy.rules.reduce(
  (counts, rule) => {
    counts[rule.state]++
    return counts
  },
  { SUPPORTED: 0, UNSUPPORTED: 0, BLOCKED: 0 },
)
const eventCounts = capabilityEvents.reduce(
  (counts, event) => {
    counts[event.state] ??= {}
    counts[event.state][event.outcome] =
      (counts[event.state][event.outcome] ?? 0) + 1
    return counts
  },
  { SUPPORTED: {}, UNSUPPORTED: {}, BLOCKED: {} },
)
const supportedFailures = [
  ...new Set(
    capabilityEvents
      .filter(
        (event) => event.state === 'SUPPORTED' && event.outcome === 'fail',
      )
      .map((event) => event.path),
  ),
].sort()
const blockedPaths = [
  ...new Set(
    capabilityEvents
      .filter((event) => event.state === 'BLOCKED')
      .map((event) => event.path),
  ),
].sort()
const unsupportedPaths = [
  ...new Set(
    capabilityEvents
      .filter((event) => event.state === 'UNSUPPORTED')
      .map((event) => event.path),
  ),
].sort()
const peak = clusters.reduce(
  (current, cluster) => ({
    workers: Math.max(current.workers, cluster.peak?.liveProcesses ?? 0),
    rss: Math.max(current.rss, cluster.peak?.rss ?? 0),
    privateMemoryBytes: Math.max(
      current.privateMemoryBytes,
      cluster.peak?.privateMemoryBytes ?? 0,
    ),
    globalMemoryBytes: Math.max(
      current.globalMemoryBytes,
      cluster.peak?.globalMemoryBytes ?? 0,
    ),
  }),
  { workers: 0, rss: 0, privateMemoryBytes: 0, globalMemoryBytes: 0 },
)
const summary = {
  schema: 1,
  status: status === 0 && supportedFailures.length === 0 ? 'pass' : 'fail',
  supportedStatus: supportedFailures.length === 0 ? 'pass' : 'fail',
  target,
  upstreamExitStatus: status,
  postgresRevision: config.postgresRevision,
  architecture: config.architecture,
  jobs: config.jobs,
  provider,
  canonicalCommand:
    target === 'check-world'
      ? `PGLITE_TEST_PROVIDER=${provider} PGLITE_TEST_CAPABILITY_RUNNER=${provider}/bin/pglite-test-capability make -j${config.jobs} -k ${target} PROVE=${provider}/bin/prove`
      : `PGLITE_TEST_PROVIDER=${provider} make -j${config.jobs} ${target}`,
  capabilityCounts,
  testPolicy: {
    defaultState: capabilities.testPolicy.defaultState,
    ruleCounts: suiteRuleCounts,
    eventCount: capabilityEvents.length,
    eventCounts,
    supportedFailures,
    blockedPaths,
    unsupportedPaths,
  },
  clusters: {
    count: clusters.length,
    passed: clusters.filter((cluster) => cluster.status === 'pass').length,
    failed: clusters.filter((cluster) => cluster.status !== 'pass').length,
  },
  peak,
  preserved: {
    log: join(out, `results/${target}.log`),
    nativeBuild: join(out, 'native/build'),
    clusterResults: clusterDirectory,
    capabilityEvents: config.capabilityEvents,
  },
  repoRoot,
}
await writeFile(
  join(out, `results/${target}.json`),
  `${JSON.stringify(summary, null, 2)}\n`,
)
console.log(JSON.stringify(summary, null, 2))
