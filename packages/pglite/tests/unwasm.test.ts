import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'

describe('unwasm', () => {
  it('pglite.data.wasm holds pglite.data in a custom section', async () => {
    const dataUrl = new URL('../dist/pglite.data', import.meta.url)
    const wasmUrl = new URL('../dist/pglite.data.wasm', import.meta.url)
    const mod = new WebAssembly.Module(await readFile(wasmUrl))
    const sections = WebAssembly.Module.customSections(mod, 'pglite.data')
    expect(sections.length).toBe(1)
    expect(Buffer.from(sections[0]).equals(await readFile(dataUrl))).toBe(true)
  })

  it('runs a query using the modules imported by the unwasm entry', async () => {
    const { PGlite } = await import('../dist/unwasm.js')
    const db = await PGlite.create()
    const res = await db.query<{ one: number }>('SELECT 1 AS one')
    expect(res.rows).toEqual([{ one: 1 }])
    await db.close()
  })
})
