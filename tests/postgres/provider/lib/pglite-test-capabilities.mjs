#!/usr/bin/env node

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const STATES = new Set(['SUPPORTED', 'UNSUPPORTED', 'BLOCKED'])
const [command, ...args] = process.argv.slice(2)
const providerRoot = resolve(
  process.env.PGLITE_TEST_PROVIDER ??
    resolve(fileURLToPath(new URL('..', import.meta.url))),
)
const config = JSON.parse(
  await readFile(resolve(providerRoot, 'config.json'), 'utf8'),
)
const manifest = JSON.parse(
  await readFile(resolve(providerRoot, 'capabilities.json'), 'utf8'),
)
validateInputs()

if (command === 'classify') {
  assert.equal(args.length, 1, 'classify requires one suite path')
  console.log(classify(args[0]).state)
} else if (command === 'record') {
  await recordFromArguments(args)
} else if (command === 'prove') {
  process.exitCode = await runProve(args)
} else {
  throw new Error(`unknown capability command: ${command ?? '<missing>'}`)
}

function validateInputs() {
  assert.equal(manifest.schema, 2, 'unsupported test capability schema')
  assert.equal(
    manifest.postgresRevision,
    config.postgresRevision,
    'capability manifest revision mismatch',
  )
  assert.ok(STATES.has(manifest.testPolicy?.defaultState))
  assert.ok(Array.isArray(manifest.testPolicy?.rules))
  for (const rule of manifest.testPolicy.rules) {
    assert.equal(typeof rule.id, 'string')
    assert.ok(['exact', 'prefix'].includes(rule.match))
    assert.equal(typeof rule.path, 'string')
    assert.ok(STATES.has(rule.state))
    assert.equal(typeof rule.reason, 'string')
    assert.ok(rule.reason.length > 0)
  }
  assert.equal(typeof config.postgresSource, 'string')
  assert.equal(typeof config.capabilityEvents, 'string')
}

function normalizePath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
}

function classify(value) {
  const path = normalizePath(value)
  const rules = [...manifest.testPolicy.rules].sort((left, right) => {
    if (left.match !== right.match) return left.match === 'exact' ? -1 : 1
    return right.path.length - left.path.length
  })
  const rule = rules.find((candidate) => {
    const candidatePath = normalizePath(candidate.path)
    return candidate.match === 'exact'
      ? path === candidatePath
      : path === candidatePath || path.startsWith(`${candidatePath}/`)
  })
  return (
    rule ?? {
      id: 'default-supported',
      match: 'prefix',
      path: '',
      state: manifest.testPolicy.defaultState,
      reason: 'No narrower capability rule applies.',
    }
  )
}

async function recordFromArguments(values) {
  const [kind, path, state, outcome, statusText, elapsedText, target] = values
  assert.ok(['suite', 'tap'].includes(kind))
  assert.ok(STATES.has(state))
  const exitStatus = Number.parseInt(statusText, 10)
  const elapsedMs = Number.parseInt(elapsedText, 10)
  assert.ok(Number.isInteger(exitStatus))
  assert.ok(Number.isInteger(elapsedMs) && elapsedMs >= 0)
  await recordEvent({
    kind,
    path: normalizePath(path),
    state,
    outcome,
    exitStatus,
    elapsedMs,
    target,
  })
}

async function recordEvent(event) {
  const rule = classify(event.path)
  assert.equal(rule.state, event.state, `state changed for ${event.path}`)
  await mkdir(config.capabilityEvents, { recursive: true })
  const record = {
    schema: 1,
    postgresRevision: config.postgresRevision,
    recordedAt: new Date().toISOString(),
    rule: {
      id: rule.id,
      match: rule.match,
      path: rule.path,
      reason: rule.reason,
    },
    ...event,
  }
  const name = `${Date.now()}-${process.pid}-${randomUUID()}.json`
  await writeFile(
    resolve(config.capabilityEvents, name),
    `${JSON.stringify(record, null, 2)}\n`,
  )
}

async function runProve(proveArgs) {
  const optionArgs = []
  const tests = []
  let optionValue = false
  for (const arg of proveArgs) {
    if (optionValue) {
      optionArgs.push(arg)
      optionValue = false
    } else if (arg === '-I' || arg === '--lib') {
      optionArgs.push(arg)
      optionValue = true
    } else if (arg.endsWith('.pl')) {
      tests.push(arg)
    } else {
      optionArgs.push(arg)
    }
  }
  assert.equal(optionValue, false, 'prove option requires a value')
  assert.ok(tests.length > 0, 'prove received no TAP test files')

  let overallStatus = 0
  for (const test of tests) {
    const path = sourceRelativePath(test)
    const rule = classify(path)
    if (rule.state === 'UNSUPPORTED') {
      console.log(`PGlite capability: UNSUPPORTED ${path} (not executed)`)
      await recordEvent({
        kind: 'tap',
        path,
        state: rule.state,
        outcome: 'unsupported',
        exitStatus: 0,
        elapsedMs: 0,
        target: 'check',
      })
      continue
    }
    if (
      rule.state === 'BLOCKED' &&
      process.env.PGLITE_POSTGRES_TEST_RUN_BLOCKED !== 'true'
    ) {
      console.log(`PGlite capability: BLOCKED ${path} (recorded, not executed)`)
      await recordEvent({
        kind: 'tap',
        path,
        state: rule.state,
        outcome: 'blocked',
        exitStatus: 0,
        elapsedMs: 0,
        target: 'check',
      })
      continue
    }

    const startedAt = Date.now()
    const status = await spawnAndWait('/usr/bin/prove', [...optionArgs, test])
    await recordEvent({
      kind: 'tap',
      path,
      state: rule.state,
      outcome: status === 0 ? 'pass' : 'fail',
      exitStatus: status,
      elapsedMs: Date.now() - startedAt,
      target: 'check',
    })
    if (status !== 0) overallStatus = status
  }
  return overallStatus
}

function sourceRelativePath(path) {
  const absolute = resolve(path)
  const source = resolve(config.postgresSource)
  const result = relative(source, absolute)
  if (result === '..' || result.startsWith(`..${sep}`) || isAbsolute(result)) {
    throw new Error(`TAP test is outside the exact-revision source: ${path}`)
  }
  return normalizePath(result)
}

function spawnAndWait(executable, childArgs) {
  return new Promise((resolveStatus, reject) => {
    const child = spawn(executable, childArgs, { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) {
        console.error(`${executable} terminated by ${signal}`)
        resolveStatus(1)
      } else {
        resolveStatus(code ?? 1)
      }
    })
  })
}
