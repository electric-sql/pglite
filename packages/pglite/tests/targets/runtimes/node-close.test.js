import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const pgliteUrl = new URL('../../../dist/index.js', import.meta.url).href

async function expectChildToExitCleanly(script) {
  const result = await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--input-type=module', '--eval', script, pgliteUrl],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stderr = ''
    let settled = false

    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(result)
    }

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr += chunk
      stderr = stderr.slice(-4_000)
    })

    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ code: null, stderr: 'PGlite close timed out' })
    }, 5_000)

    child.on('error', (error) => {
      finish({ code: null, stderr: error.message })
    })
    child.on('exit', (code) => {
      finish({ code, stderr })
    })
  })

  expect(result).toEqual({ code: 0, stderr: '' })
}

describe('close', () => {
  it('waits for an in-flight query before shutting down', async () => {
    await expectChildToExitCleanly(`
      const { PGlite } = await import(process.argv[1])
      const db = new PGlite()

      await db.exec('CREATE TABLE t (workflow_name TEXT, run_id TEXT)')
      await db.exec("INSERT INTO t VALUES ('agentic-loop', 'run-1')")

      const query = db.query(
        'DELETE FROM t WHERE workflow_name = $1 AND run_id = $2',
        ['agentic-loop', 'run-1'],
      )
      const close = db.close()

      await Promise.all([query, close])
    `)
  }, 10_000)

  it('waits for an active transaction before shutting down', async () => {
    await expectChildToExitCleanly(`
      const { PGlite } = await import(process.argv[1])
      const db = new PGlite()

      await db.exec('CREATE TABLE t (value INTEGER)')

      let markTransactionStarted
      const transactionStarted = new Promise((resolve) => {
        markTransactionStarted = resolve
      })
      let resumeTransaction
      const transactionGate = new Promise((resolve) => {
        resumeTransaction = resolve
      })
      const events = []

      const transaction = db.transaction(async (tx) => {
        markTransactionStarted()
        await transactionGate
        await tx.query('INSERT INTO t VALUES (1)')
        events.push('transaction')
      })

      await transactionStarted
      const close = db.close().then(() => events.push('close'))
      resumeTransaction()
      await Promise.all([transaction, close])

      if (events.join(',') !== 'transaction,close') {
        throw new Error('close did not wait for the active transaction')
      }
    `)
  }, 10_000)

  it('closes once during initialization and rejects later queries', async () => {
    const { PGlite } = await import(pgliteUrl)
    const db = new PGlite()

    const firstClose = db.close()
    expect(db.close()).toBe(firstClose)
    await expect(db.query('SELECT 1')).rejects.toThrow('PGlite is closing')

    await firstClose
    expect(db.closed).toBe(true)
  }, 10_000)
})
