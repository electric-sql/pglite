import { describe, expect, test } from 'vitest'
import type { Filesystem } from '../src/fs/base.js'
import { assertPostmasterFilesystemSelection } from '../src/postmaster/node/filesystem-selection.js'

describe('postmaster filesystem selection', () => {
  test('preserves legacy broker and explicit worker-factory selection', () => {
    expect(() =>
      assertPostmasterFilesystemSelection({} as Filesystem, undefined),
    ).not.toThrow()
    expect(() =>
      assertPostmasterFilesystemSelection(undefined, { module: 'factory' }),
    ).not.toThrow()
  })

  test('rejects ambiguous or explicitly unsupported selections', () => {
    expect(() =>
      assertPostmasterFilesystemSelection({} as Filesystem, {
        module: 'factory',
      }),
    ).toThrow('mutually exclusive')
    expect(() =>
      assertPostmasterFilesystemSelection(
        filesystemWithAccess('unsupported'),
        undefined,
      ),
    ).toThrow('does not support multi-session')
    expect(() =>
      assertPostmasterFilesystemSelection(undefined, {
        module: 'factory',
        capabilities: { multiSession: 'unsupported' },
      }),
    ).toThrow('does not support multi-session')
  })

  test('requires the transport selected by capability metadata', () => {
    expect(() =>
      assertPostmasterFilesystemSelection(
        filesystemWithAccess('worker-factory'),
        undefined,
      ),
    ).toThrow('requires a workerFilesystem factory')
    expect(() =>
      assertPostmasterFilesystemSelection(undefined, {
        module: 'factory',
        capabilities: { multiSession: 'supervisor-broker' },
      }),
    ).toThrow('must be supplied as fs')
  })
})

function filesystemWithAccess(
  multiSession: 'supervisor-broker' | 'worker-factory' | 'unsupported',
): Filesystem {
  return { capabilities: { multiSession } } as Filesystem
}
