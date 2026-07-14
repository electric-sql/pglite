import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

export const testsDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
)
export const toolDirectory = resolve(testsDirectory, '..')
export const outputDirectory = join(toolDirectory, '.out', 'transformer-tests')

export const artifact = (...parts: string[]): string =>
  join(outputDirectory, ...parts)

export const fixture = (...parts: string[]): string =>
  join(testsDirectory, 'fixtures', ...parts)

export const runtimeCapability = (...parts: string[]): string =>
  join(toolDirectory, 'runtime-capabilities', ...parts)
