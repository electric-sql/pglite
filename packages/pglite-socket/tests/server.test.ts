import { describe, it, expect, afterEach } from 'vitest'
import { spawn, ChildProcess } from 'node:child_process'
import { createConnection } from 'net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const serverScript = path.resolve(__dirname, '../src/scripts/server.ts')

// Helper to wait for a port to be available
async function waitForPort(port: number, timeout = 15000): Promise<boolean> {
  const start = Date.now()

  while (Date.now() - start < timeout) {
    try {
      const socket = createConnection({ port, host: '127.0.0.1' })
      await new Promise<void>((resolve, reject) => {
        socket.on('connect', () => {
          socket.end()
          resolve()
        })
        socket.on('error', reject)
      })
      return true
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  return false
}

describe('Server Script Tests', () => {
  const TEST_PORT_BASE = 15500
  let currentTestPort = TEST_PORT_BASE

  // Get a unique port for each test
  function getTestPort(): number {
    return ++currentTestPort
  }

  describe('Help and Basic Functionality', () => {
    it('should show help when --help flag is used', async () => {
      const serverProcess = spawn('tsx', [serverScript, '--help'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let output = ''
      serverProcess.stdout?.on('data', (data) => {
        output += data.toString()
      })

      serverProcess.stderr?.on('data', (data) => {
        console.error(data.toString())
      })

      await new Promise<void>((resolve) => {
        serverProcess.on('exit', (code) => {
          expect(code).toBe(0)
          expect(output).toContain('PGlite Socket Server')
          expect(output).toContain('Usage:')
          expect(output).toContain('Options:')
          expect(output).toContain('--db')
          expect(output).toContain('--port')
          expect(output).toContain('--host')
          resolve()
        })
      })
    }, 10000)

    it('should accept and use debug level parameter', async () => {
      const testPort = getTestPort()
      const serverProcess = spawn(
        'tsx',
        [serverScript, '--port', testPort.toString(), '--debug', '2'],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      )

      let output = ''
      serverProcess.stdout?.on('data', (data) => {
        output += data.toString()
      })

      serverProcess.stderr?.on('data', (data) => {
        console.error(data.toString())
      })

      // Wait for server to start
      await waitForPort(testPort)

      // Kill the server
      serverProcess.kill('SIGTERM')

      await new Promise<void>((resolve) => {
        serverProcess.on('exit', () => {
          expect(output).toContain('Debug level: 2')
          resolve()
        })
      })
    }, 10000)
  })

  describe('Server Startup and Connectivity', () => {
    let serverProcess: ChildProcess | null = null

    afterEach(async () => {
      if (serverProcess) {
        serverProcess.kill('SIGTERM')
        await new Promise<void>((resolve) => {
          if (serverProcess) {
            serverProcess.on('exit', () => resolve())
          } else {
            resolve()
          }
        })
        serverProcess = null
      }
    })

    it('should start server on TCP port and accept connections', async () => {
      const testPort = getTestPort()

      serverProcess = spawn(
        'tsx',
        [serverScript, '--port', testPort.toString()],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      )

      let output = ''
      serverProcess.stdout?.on('data', (data) => {
        output += data.toString()
      })

      serverProcess.stderr?.on('data', (data) => {
        console.error(data.toString())
      })

      // Wait for server to be ready
      const isReady = await waitForPort(testPort)
      expect(isReady).toBe(true)

      // Check that we can connect
      const socket = createConnection({ port: testPort, host: '127.0.0.1' })
      await new Promise<void>((resolve, reject) => {
        socket.on('connect', resolve)
        socket.on('error', reject)
        setTimeout(() => reject(new Error('Connection timeout')), 3000)
      })
      socket.end()

      expect(output).toContain('PGlite database initialized')
      expect(output).toContain(`"port":${testPort}`)
    }, 10000)

    it('should work with memory database', async () => {
      const testPort = getTestPort()

      serverProcess = spawn(
        'tsx',
        [serverScript, '--port', testPort.toString(), '--db', 'memory://'],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      )

      let output = ''
      serverProcess.stdout?.on('data', (data) => {
        output += data.toString()
      })

      serverProcess.stderr?.on('data', (data) => {
        console.error(data.toString())
      })

      const isReady = await waitForPort(testPort)
      expect(isReady).toBe(true)
      expect(output).toContain('Initializing PGLite with database: memory://')
    }, 10000)
  })

  describe('Configuration Options', () => {
    let serverProcess: ChildProcess | null = null

    afterEach(async () => {
      if (serverProcess) {
        serverProcess.kill('SIGTERM')
        await new Promise<void>((resolve) => {
          if (serverProcess) {
            serverProcess.on('exit', () => resolve())
          } else {
            resolve()
          }
        })
        serverProcess = null
      }
    })

    it('should handle different hosts', async () => {
      const testPort = getTestPort()

      serverProcess = spawn(
        'tsx',
        [serverScript, '--port', testPort.toString(), '--host', '0.0.0.0'],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      )

      let output = ''
      serverProcess.stdout?.on('data', (data) => {
        output += data.toString()
      })

      serverProcess.stderr?.on('data', (data) => {
        console.error(data.toString())
      })

      const isReady = await waitForPort(testPort)
      expect(isReady).toBe(true)
      serverProcess.kill()
      await new Promise<void>((resolve) => {
        serverProcess.on('exit', () => {
          expect(output).toContain(`"host":"0.0.0.0"`)
          serverProcess = null
          resolve()
        })
      })
    }, 10000)
  })
})
