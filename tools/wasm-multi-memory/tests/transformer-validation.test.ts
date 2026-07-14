import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { artifact } from './support/artifacts.js'

interface FailureCase {
  name: string
  input: string
  message: string
  args?: string[]
}

const failureCases: FailureCase[] = [
  {
    name: 'an already transformed module',
    input: 'opcodes.multi.wasm',
    message: 'already has PGlite memory ABI metadata',
  },
  {
    name: 'multiple input memories',
    input: 'multiple-input-memories.wasm',
    message: 'exactly one conventional memory',
  },
  {
    name: 'an unimported private memory',
    input: 'unimported-memory.wasm',
    message: 'private memory must be imported',
  },
  {
    name: 'a private memory exceeding the pointer aperture',
    input: 'oversized-memory.wasm',
    message: 'private memory maximum exceeds 2 GiB aperture',
  },
  {
    name: 'inverted global memory limits',
    input: 'opcodes.wasm',
    message: 'invalid global memory limits',
    args: ['--global-initial-pages', '17', '--global-maximum-pages', '16'],
  },
  {
    name: 'a missing private-return export',
    input: 'provenance.wasm',
    message: 'private-return export is not a function',
    args: ['--provenance', '--private-return-export', 'missing'],
  },
]

function transformFailure(testCase: FailureCase): Promise<string> {
  const output = artifact(`rejected-${testCase.name.replaceAll(' ', '-')}.wasm`)
  return new Promise((resolve, reject) => {
    execFile(
      'pglite-wasm-multi-memory',
      [
        testCase.input.startsWith('/')
          ? testCase.input
          : artifact(testCase.input),
        '-o',
        output,
        ...(testCase.args ?? []),
      ],
      (error, stdout, stderr) => {
        if (!error) {
          reject(new Error(`transform unexpectedly accepted ${testCase.name}`))
          return
        }
        resolve(`${stdout}${stderr}`)
      },
    )
  }).finally(() => rm(output, { force: true }))
}

it.each(failureCases)('rejects $name', async (testCase) => {
  expect(await transformFailure(testCase)).toContain(testCase.message)
})

it('produces a module Binaryen and V8 both validate', async () => {
  expect(WebAssembly.validate(await readFile(artifact('validated.wasm')))).toBe(
    true,
  )
})
