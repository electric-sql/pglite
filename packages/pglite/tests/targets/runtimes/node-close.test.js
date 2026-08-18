import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const pgliteUrl = new URL('../../../dist/index.js', import.meta.url).href

describe('close', () => {
  it('waits for an in-flight query before shutting down', async () => {
    const script = `
      const { PGlite } = await import(process.argv[1])
      const db = new PGlite()

      await db.exec('CREATE TABLE t (workflow_name TEXT, run_id TEXT)')
      await db.exec("INSERT INTO t VALUES ('agentic-loop', 'run-1')")

      const query = db.query(
        'DELETE FROM t WHERE workflow_name = $1 AND run_id = $2',
        ['agentic-loop', 'run-1'],
      )
      const firstClose = db.close()
      const secondClose = db.close()

      await Promise.all([query, firstClose, secondClose])

      const db2 = new PGlite()
      await db2.waitReady
      const close = db2.close()
      const rejectedQuery = db2.query('SELECT 1').then(
        () => false,
        (error) => error.message === 'PGlite is closing',
      )

      if (!(await rejectedQuery)) {
        throw new Error('query started after close was not rejected')
      }
      await close
    `

    const result = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        ['--input-type=module', '--eval', script, pgliteUrl],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )
      let stderr = ''
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk) => {
        stderr += chunk
      })

      const timeout = setTimeout(() => {
        child.kill('SIGKILL')
        resolve({ code: null, stderr: 'PGlite close timed out' })
      }, 5_000)

      child.on('exit', (code) => {
        clearTimeout(timeout)
        resolve({ code, stderr })
      })
    })

    expect(result).toEqual({ code: 0, stderr: '' })
  }, 10_000)
})
