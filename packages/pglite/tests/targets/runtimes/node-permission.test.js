import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import * as fs from 'fs/promises'
import * as path from 'path'

const execFileAsync = promisify(execFile)

const packageDir = fileURLToPath(new URL('../../../', import.meta.url))
const distIndexUrl = new URL('../../../dist/index.js', import.meta.url).href
const dataDir = path.resolve('./pgdata-permission-test')

const supportsPermissionModel =
  process.allowedNodeEnvironmentFlags.has('--permission')

const runWithPermissionModel = (dataDirArg) =>
  execFileAsync(
    process.execPath,
    [
      '--permission',
      `--allow-fs-read=${packageDir}`,
      `--allow-fs-read=${dataDir}`,
      `--allow-fs-write=${dataDir}`,
      '--input-type=module',
      '--eval',
      `
      import { PGlite } from ${JSON.stringify(distIndexUrl)}
      const db = new PGlite(${JSON.stringify(dataDirArg)})
      const res = await db.query('SELECT 1 AS one')
      console.log(JSON.stringify(res.rows))
      await db.close()
      `,
    ],
    { timeout: 60000 },
  )

describe.runIf(supportsPermissionModel)('node permission model', () => {
  beforeAll(async () => {
    await fs.rm(dataDir, { force: true, recursive: true })
    await fs.mkdir(dataDir, { recursive: true })
  })
  afterAll(async () => {
    await fs.rm(dataDir, { force: true, recursive: true })
  })

  it('starts an in-memory database under --permission', async () => {
    const { stdout } = await runWithPermissionModel('memory://')
    expect(JSON.parse(stdout)).toEqual([{ one: 1 }])
  })

  it('starts a NODEFS database under --permission', async () => {
    const { stdout } = await runWithPermissionModel(path.join(dataDir, 'db'))
    expect(JSON.parse(stdout)).toEqual([{ one: 1 }])
  })
})
