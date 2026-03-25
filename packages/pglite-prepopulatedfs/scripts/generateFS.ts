import { PGlite } from '@electric-sql/pglite'
import { resolve } from 'path'
const fs = await import('fs')

const pglite = await PGlite.create()
const dataDirArchive = await pglite.dumpDataDir('gzip')
console.info('Removing release folder')
fs.rmSync(resolve('release'), { recursive: true, force: true })
try {
    console.info('Creating release folder')
    fs.mkdirSync(resolve('release'))
    console.info('Writing preloaded FS file to disk')
    fs.writeFileSync(resolve('release/prepopulatedfs.tgz'), Buffer.from(await dataDirArchive.arrayBuffer()))
    console.info('Success writing file to disk')
} catch (e) {
    console.error(e)
}
await pglite.close()
console.info('PGlite closed')

