import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('postmaster package boundaries', () => {
  test('selects the Node runtime for ordinary ESM and CommonJS imports', () => {
    expect(
      runNode([
        '-e',
        "import('@electric-sql/pglite/postmaster').then(({ PGlitePostmaster }) => console.log(typeof PGlitePostmaster.create))",
      ]),
    ).toBe('function')
    expect(
      runNode([
        '-e',
        "console.log(typeof require('@electric-sql/pglite/postmaster').PGlitePostmaster.create)",
      ]),
    ).toBe('function')
  })

  test('selects a fail-fast stub for browser resolution', () => {
    expect(
      runNode([
        '--conditions=browser',
        '-e',
        "import('@electric-sql/pglite/postmaster').then(async ({ PGlitePostmaster }) => { try { await PGlitePostmaster.create({}) } catch (error) { console.log(error.name) } })",
      ]),
    ).toBe('PGlitePostmasterUnavailableError')
  })

  test('exports the direct Node lease provider for pluggable filesystems', () => {
    expect(
      runNode([
        '-e',
        "import('@electric-sql/pglite/nodefs').then(({ NodeClusterLeaseProvider }) => console.log(typeof NodeClusterLeaseProvider))",
      ]),
    ).toBe('function')
    expect(
      runNode([
        '-e',
        "console.log(typeof require('@electric-sql/pglite/nodefs').NodeClusterLeaseProvider)",
      ]),
    ).toBe('function')
  })

  test('keeps postmaster and Node modules outside the root ESM graph', () => {
    const graph = collectLocalModuleGraph(resolve(packageRoot, 'dist/index.js'))
    expect([...graph]).not.toContainEqual(
      expect.stringContaining('/postmaster/'),
    )
    for (const file of graph) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).not.toMatch(/(?:from|import\()\s*['"]node:/)
      expect(source, file).not.toContain('process-worker.js')
      expect(source, file).not.toContain('pglite-shared.wasm')
    }
  })

  test('resolves bundled PGlite artifacts from the package dist directory', () => {
    const commonJsBundle = readFileSync(
      resolve(packageRoot, 'dist/postmaster/index.cjs'),
      'utf8',
    )
    expect(commonJsBundle).not.toContain('../release/pglite.')
    expect(commonJsBundle).toContain('../pglite.data')
    expect(commonJsBundle).toContain('../pglite.wasm')
  })
})

function runNode(arguments_: readonly string[]): string {
  const result = spawnSync(process.execPath, arguments_, {
    cwd: packageRoot,
    encoding: 'utf8',
  })
  expect(result.status, result.stderr).toBe(0)
  return result.stdout.trim()
}

function collectLocalModuleGraph(entry: string): Set<string> {
  const pending = [entry]
  const visited = new Set<string>()
  const imports =
    /(?:import|export)\s*(?:[^'";]*?\sfrom\s*)?['"](\.[^'"]+)['"]/g

  while (pending.length > 0) {
    const file = pending.pop()!
    if (visited.has(file)) continue
    visited.add(file)
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(imports)) {
      const imported = resolve(dirname(file), match[1])
      if (imported.endsWith('.js')) pending.push(imported)
    }
  }

  return visited
}
