import { PGlite } from '../../dist/index.js'

const dataDir = process.argv[2]
if (!dataDir) throw new Error('missing data directory')

await PGlite.create(`file://${dataDir}`)
process.send?.('ready')
setInterval(() => {}, 60_000)
