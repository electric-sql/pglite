import { describe, expect, it } from 'vitest'
import { PassThrough, Readable } from 'node:stream'
import {
  nativeToolCommands,
  nativeToolRuntimeIdentity,
} from '../src/native-tool-identity.js'
import { nativeToolRunners } from '../src/native-tools-internal.js'

describe('native PostgreSQL tool registry', () => {
  it('has one revision-identified runner for every packaged command', () => {
    expect(Object.keys(nativeToolRunners).sort()).toEqual(
      [...nativeToolCommands].sort(),
    )
    for (const command of nativeToolCommands) {
      expect(nativeToolRunners[command].command).toBe(command)
      expect(
        nativeToolRuntimeIdentity.artifacts[command].artifactSha256,
      ).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('gives every packaged runner the shared cancellation contract', async () => {
    for (const command of nativeToolCommands) {
      const controller = new AbortController()
      controller.abort()
      await expect(
        nativeToolRunners[command].run({
          argv: ['--version'],
          env: { LANG: 'C' },
          stdin: Readable.from([]),
          stdout: new PassThrough(),
          stderr: new PassThrough(),
          signal: controller.signal,
        }),
      ).resolves.toBe(130)
    }
  })
})
