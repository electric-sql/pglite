import { join } from 'node:path'
import { describe, test } from 'vitest'
import { integrationConfig, runScenario } from './scenario-runner.js'

const config = integrationConfig()
const artifact = [config.wasm, config.glue, config.data] as const
const output = (name: string) => join(config.outputRoot, `${name}.json`)

describe.sequential('Worker-backed PGlite postmaster integration', () => {
  test('implements hierarchical scoped memory', async () => {
    await runScenario(
      new URL('./scenarios/scope-hierarchy.mjs', import.meta.url),
      [...artifact],
    )
  })

  test('supports compact memory binding', async () => {
    await runScenario(
      new URL('./scenarios/compact-binding.mjs', import.meta.url),
      [...artifact],
    )
  })

  test('supports pluggable Worker filesystems', async () => {
    await runScenario(
      new URL('./scenarios/filesystem-factory.mjs', import.meta.url),
      [config.repoRoot, ...artifact],
    )
  })

  test('speaks the postmaster/backend protocol', async () => {
    await runScenario(
      new URL('./scenarios/postmaster-session.mjs', import.meta.url),
      [config.repoRoot, ...artifact],
    )
  })

  test('provides independent PostgreSQL sessions', async () => {
    await runScenario(
      new URL('./scenarios/postmaster-correctness.mjs', import.meta.url),
      [config.repoRoot, ...artifact, output('focused-correctness')],
    )
  })

  test('runs parallel queries with compact roots', async () => {
    await runScenario(
      new URL('./scenarios/compact-postmaster.mjs', import.meta.url),
      [config.repoRoot, ...artifact, output('focused-correctness')],
    )
  })

  test('loads transformed dynamic side modules', async () => {
    await runScenario(
      new URL('./scenarios/dynamic-side-module.mjs', import.meta.url),
      [
        config.repoRoot,
        ...artifact,
        config.dynamic.raw,
        config.dynamic.transformed,
        config.dynamic.audit,
      ],
    )
  })

  test('supports brokered filesystems and failure cleanup', async () => {
    await runScenario(
      new URL('./scenarios/brokered-filesystem.mjs', import.meta.url),
      [config.repoRoot, ...artifact],
    )
  })
})
