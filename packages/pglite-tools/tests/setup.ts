import { beforeAll } from 'vitest'
import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

beforeAll(() => {
  // Check if we need to build
  const distPath = join(__dirname, '../dist')
  const wasmPath = join(distPath, 'pg_dump.wasm')

  if (!existsSync(wasmPath)) {
    console.log('Building project before running tests...')
    execSync('pnpm build', { stdio: 'inherit' })
  }
})
