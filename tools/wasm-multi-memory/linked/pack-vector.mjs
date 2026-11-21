import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ts from 'typescript'

const output = resolve(process.argv[2])
const license = process.argv[3]
const pkg = join(output, 'pgvector')
mkdirSync(pkg, { recursive: true })
const metadata = JSON.parse(
  readFileSync('packages/pglite-pgvector/package.json'),
)
const core = JSON.parse(readFileSync('packages/pglite/package.json'))
const generated = join(output, 'generated-artifacts.ts')
execFileSync(process.execPath, [
  'tools/wasm-multi-memory/extensions/generate-wrapper.mjs',
  generated,
  JSON.parse(readFileSync(join(output, 'vector.json'))).targetKey +
    '=' +
    join(output, 'vector.json') +
    '=./vector.tar.gz',
])
const { outputText } = ts.transpileModule(readFileSync(generated, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
})
writeFileSync(join(pkg, 'generated-artifacts.js'), outputText)
copyFileSync('packages/pglite-pgvector/src/index.ts', join(pkg, 'index.js'))
copyFileSync(join(output, 'vector.tar.gz'), join(pkg, 'vector.tar.gz'))
copyFileSync('LICENSE', join(pkg, 'LICENSE'))
copyFileSync(license, join(pkg, 'PGVECTOR-LICENSE'))
writeFileSync(
  join(pkg, 'package.json'),
  JSON.stringify({
    name: metadata.name,
    version: metadata.version + '-' + (process.argv[4] ?? 'linked.0'),
    license: metadata.license,
    type: 'module',
    exports: './index.js',
    files: [
      'index.js',
      'generated-artifacts.js',
      'vector.tar.gz',
      'PGVECTOR-LICENSE',
    ],
    peerDependencies: { [core.name]: core.version },
  }),
)
console.log(
  execFileSync(
    'npm',
    ['pack', '--ignore-scripts', '--pack-destination', output, '--silent'],
    { cwd: pkg, encoding: 'utf8' },
  ).trim(),
)
