import { describe, expect, it } from 'vitest'
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
})
