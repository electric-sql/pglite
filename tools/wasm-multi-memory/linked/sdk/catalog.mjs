import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
} from 'node:fs'
import { join, resolve } from 'node:path'

const [action, output] = process.argv.slice(2)
const out = resolve(output)
const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
const catalog = join(out, 'catalog.json')
if (action === 'plan') {
  const core = 'packages/pglite'
  const pkg = read(join(core, 'package.json'))
  const target = read(
    'packages/pglite-pgvector/extension-artifacts/wasm32-classic.json',
  ).target
  const excluded = new Set(
    pkg.files.filter((x) => x.startsWith('!dist/')).map((x) => x.slice(6)),
  )
  const contrib = readdirSync(join(out, 'classic/extensions')).filter(
    (x) => x.endsWith('.tar.gz') && !excluded.has(x),
  )
  const thirdParty = readdirSync(join(out, 'classic/extensions/other')).filter(
    (x) => x.endsWith('.tar.gz'),
  )
  const entries = []
  mkdirSync(join(out, 'configs'), { recursive: true })
  for (const [bundled, archives] of [
    [true, contrib],
    [false, thirdParty],
  ]) {
    for (const archive of archives.sort()) {
      const name = archive.slice(0, -7).replace(/^pgmq-extension$/, 'pgmq')
      const symbol = name.replaceAll('-', '_')
      const dir = bundled
        ? core
        : 'packages/pglite-' + (name === 'vector' ? 'pgvector' : name)
      const { version, name: packageName } = read(join(dir, 'package.json'))
      const configPath = join(dir, 'extension-artifacts/wasm32-classic.json')
      const config =
        !bundled && existsSync(configPath)
          ? read(configPath)
          : { extensionName: name, extensionVersion: version, target }
      if (name === 'earthdistance')
        config.artifactDependencies = [
          { extensionName: 'cube', versionRange: version },
        ]
      if (['pg_stat_statements', 'pg_textsearch'].includes(name))
        config.requiredSharedPreloadLibraries = [name]
      writeFileSync(
        join(out, 'configs', name + '.json'),
        JSON.stringify(config),
      )
      entries.push({
        name,
        symbol,
        dir,
        bundled,
        importPath: bundled ? packageName + '/contrib/' + symbol : packageName,
        source: join('classic/extensions', bundled ? '' : 'other', archive),
      })
    }
  }
  writeFileSync(catalog, JSON.stringify(entries, null, 2) + '\n')
} else if (action === 'wrappers') {
  const entries = read(catalog)
  for (const { name, symbol, dir, bundled } of entries) {
    const base = join(dir, 'src')
    const generated = bundled
      ? join(base, 'contrib', 'generated', symbol + '.ts')
      : join(base, 'generated-artifacts.ts')
    const release = join(dir, 'release')
    mkdirSync(release, { recursive: true })
    if (bundled)
      mkdirSync(join(base, 'contrib', 'generated'), { recursive: true })
    const descriptor = join(out, 'extensions', name + '.json')
    const archivePath =
      (bundled ? '../../release/' : '../release/') + name + '.tar.gz'
    execFileSync(
      process.execPath,
      [
        'tools/wasm-multi-memory/extensions/generate-wrapper.mjs',
        generated,
        'wasm32-faceted=' + descriptor + '=' + archivePath,
      ],
      {
        env: {
          ...process.env,
          PGLITE_WRAPPER_TYPE_IMPORT: bundled
            ? '../../extension-artifacts.js'
            : '@electric-sql/pglite',
        },
      },
    )
    if (!bundled && ['vector', 'postgis'].includes(name)) continue
    writeFileSync(
      bundled ? join(base, 'contrib', symbol + '.ts') : join(base, 'index.ts'),
      `import { defineExtension } from '${bundled ? '../extension.js' : '@electric-sql/pglite'}'\n` +
        `import { generatedExtensionBackend } from '${bundled ? './generated/' + symbol : './generated-artifacts'}.js'\n` +
        `export const ${symbol} = defineExtension({ name: ${JSON.stringify(name)}, backend: generatedExtensionBackend })\n`,
    )
  }
} else throw Error('expected plan or wrappers')
