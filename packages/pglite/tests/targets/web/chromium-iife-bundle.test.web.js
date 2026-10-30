import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import playwright from 'playwright'
import * as fs from 'fs/promises'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { build } from 'esbuild'

const distDir = fileURLToPath(new URL('../../../dist/', import.meta.url))
const ORIGIN = 'http://pglite.test'

// esbuild replaces `import.meta` with `{}` in IIFE output, so
// `import.meta.url` is undefined in the bundle. The documented workaround for
// that case is to pass `pgliteWasmModule`, `initdbWasmModule` and `fsBundle`
// explicitly, so PGlite never needs to resolve its own assets.
const entry = `
import { PGlite } from ${JSON.stringify(path.join(distDir, 'index.js'))}

window.runPGlite = async () => {
  const [pgliteWasmModule, initdbWasmModule, fsBundle] = await Promise.all([
    WebAssembly.compileStreaming(fetch('/pglite.wasm')),
    WebAssembly.compileStreaming(fetch('/initdb.wasm')),
    fetch('/pglite.data').then((response) => response.blob()),
  ])
  const db = await PGlite.create({
    pgliteWasmModule,
    initdbWasmModule,
    fsBundle,
  })
  const res = await db.query('SELECT 1 AS one')
  await db.close()
  return res.rows
}
`

const contentTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
}

describe('chromium IIFE bundle', () => {
  let browser
  let bundle

  beforeAll(async () => {
    const result = await build({
      stdin: { contents: entry, resolveDir: distDir, loader: 'js' },
      bundle: true,
      format: 'iife',
      platform: 'browser',
      // Node built-ins are only imported on the Node code path.
      external: ['node:*', 'fs', 'fs/promises', 'path', 'url', 'crypto'],
      write: false,
      logLevel: 'silent',
    })
    bundle = result.outputFiles[0].text
    browser = await playwright.chromium.launch()
  })

  afterAll(async () => {
    await browser?.close()
  })

  it('starts when the wasm modules and fs bundle are passed in', async () => {
    const page = await browser.newPage()
    await page.route(`${ORIGIN}/**`, async (route) => {
      const { pathname } = new URL(route.request().url())
      if (pathname === '/') {
        return route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html>',
        })
      }
      if (pathname === '/bundle.js') {
        return route.fulfill({ contentType: 'text/javascript', body: bundle })
      }
      const body = await fs.readFile(path.join(distDir, pathname.slice(1)))
      return route.fulfill({
        contentType: contentTypes[path.extname(pathname)],
        body,
      })
    })
    await page.goto(`${ORIGIN}/`)
    await page.addScriptTag({ url: '/bundle.js' })
    const rows = await page.evaluate(() => window.runPGlite())
    expect(rows).toEqual([{ one: 1 }])
  })
})
