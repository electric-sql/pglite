import type { Filesystem } from '../../fs/base.js'
import type { WorkerFilesystemFactory } from './worker-types.js'

export function assertPostmasterFilesystemSelection(
  filesystem: Filesystem | undefined,
  workerFactory: WorkerFilesystemFactory | undefined,
): void {
  if (filesystem && workerFactory) {
    throw new TypeError('fs and workerFilesystem are mutually exclusive')
  }

  const filesystemAccess = filesystem?.capabilities?.multiSession
  if (filesystemAccess === 'unsupported') {
    throw new TypeError('The selected fs does not support multi-session use')
  }
  if (filesystemAccess === 'worker-factory') {
    throw new TypeError(
      'The selected fs requires a workerFilesystem factory for multi-session use',
    )
  }

  const factoryAccess = workerFactory?.capabilities?.multiSession
  if (factoryAccess === 'unsupported') {
    throw new TypeError(
      'The selected workerFilesystem does not support multi-session use',
    )
  }
  if (factoryAccess === 'supervisor-broker') {
    throw new TypeError(
      'The selected workerFilesystem must be supplied as fs for supervisor brokering',
    )
  }
}

export async function loadWorkerFilesystem(
  factory: WorkerFilesystemFactory,
): Promise<Filesystem> {
  const namespace = (await import(factory.module)) as Record<string, unknown>
  const exported = namespace[factory.export ?? 'default']
  if (typeof exported !== 'function') {
    throw new TypeError(
      `Worker filesystem export ${factory.export ?? 'default'} is not a factory function`,
    )
  }
  const filesystem = await (
    exported as (options: unknown) => Filesystem | Promise<Filesystem>
  )(factory.options)
  if (!filesystem || typeof filesystem.init !== 'function') {
    throw new TypeError(
      'Worker filesystem factory did not return a PGlite Filesystem',
    )
  }
  return filesystem
}
