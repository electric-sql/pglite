#!/usr/bin/env node
import { PGlite } from '@electric-sql/pglite'
import { resolve } from 'path'
const fs = await import('fs')

const pglite = await PGlite.create()
const dataDirArchive = await pglite.dumpDataDir('gzip')
console.info('Removing release')
fs.rmSync(resolve('release'), { recursive: true, force: true })
try {
    console.info('Creating release')
    fs.mkdirSync(resolve('release'))
    console.info('Writing file to disk')
    fs.writeFileSync(resolve('release/prepopulatedfs.tgz'), Buffer.from(await dataDirArchive.arrayBuffer()))
    console.info('Success writing file to disk')
} catch (e) {
    console.error(e)
}
pglite.close()
console.info('PGlite closed')



