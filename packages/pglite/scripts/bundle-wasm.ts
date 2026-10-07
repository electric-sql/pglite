import * as fs from 'fs/promises'
import { copyFiles, findAndReplaceInDir } from '@electric-sql/pglite-utils/scripts/fileUtils'

function encodeULEB128(value: number): Buffer {
  const bytes: number[] = []
  do {
    let byte = value & 0x7f
    value >>>= 7
    if (value !== 0) byte |= 0x80
    bytes.push(byte)
  } while (value !== 0)
  return Buffer.from(bytes)
}

// Wrap `data` in a custom section of an otherwise empty Wasm module so it can be
// imported via unwasm, and read back with `WebAssembly.Module.customSections`.
async function wrapInWasmCustomSection(
  inFile: string,
  outFile: string,
  sectionName: string,
) {
  const data = await fs.readFile(inFile)
  const name = Buffer.from(sectionName, 'utf8')
  const nameLength = encodeULEB128(name.length)
  const sectionSize = nameLength.length + name.length + data.length
  await fs.writeFile(
    outFile,
    Buffer.concat([
      Buffer.from([0x00, 0x61, 0x73, 0x6d]), // magic: \0asm
      Buffer.from([0x01, 0x00, 0x00, 0x00]), // version: 1
      Buffer.from([0x00]), // section id: custom
      encodeULEB128(sectionSize),
      nameLength,
      name,
      data,
    ]),
  )
}

async function main() {
  await copyFiles('./release', './dist')
  await wrapInWasmCustomSection(
    './dist/pglite.data',
    './dist/pglite.data.wasm',
    'pglite.data',
  )
  await findAndReplaceInDir('./dist', /\.\.\/release\//g, './', ['.js', '.cjs'])
  await findAndReplaceInDir('./dist/contrib', /\.\.\/release\//g, '', [
    '.js',
    '.cjs',
  ])
  await findAndReplaceInDir(
    './dist',
    `require("./postgres.js")`,
    `require("./postgres.cjs").default`,
    ['.cjs'],
  )
}

await main()
