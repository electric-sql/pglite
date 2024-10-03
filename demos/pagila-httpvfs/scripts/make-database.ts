import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extract as tarExtract } from 'tar'

const SCHEMA_URL =
  'https://raw.githubusercontent.com/devrimgunduz/pagila/refs/heads/master/pagila-schema.sql'
const DATA_URL =
  'https://raw.githubusercontent.com/devrimgunduz/pagila/refs/heads/master/pagila-insert-data.sql'
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url))

// Download the schema and data from the internet
console.log('Downloading schema...')
const schema = await fetch(SCHEMA_URL).then((r) => r.text())
console.log('Downloading data...')
const data = await fetch(DATA_URL).then((r) => r.text())

// Create a new PGlite instance
console.log('Creating database...')
const pg = await PGlite.create()

// Initialize the schema
console.log('Initializing database schema...')
await pg.exec(schema)

// Split the data into lines and execute each line so as to not run out of memory
console.log('Inserting database data...')
const dataLines = data.split('\n').filter((line) => line.trim().length > 0 && !line.startsWith('--'))
for (const line of dataLines) {
  try {
    await pg.exec(line)
  } catch (e) {
    console.error(line)
    console.error(e)
    process.exit(1)
  }
}

console.log('Vacuuming database...')
await pg.exec('VACUUM ANALYZE')
await pg.exec('CHECKPOINT')

console.log('Dumping database...')
const file = await pg.dumpDataDir()

console.log('Writing database...')
await fs.writeFile(
  path.join(THIS_DIR, '..', 'public', 'pagila.tar.gz'),
  Buffer.from(await file.arrayBuffer()),
)

console.log('Extracting database...')
await fs.mkdir(path.join(THIS_DIR, '..', 'public', 'pagila'))
await tarExtract({
  file: path.join(THIS_DIR, '..', 'public', 'pagila.tar.gz'),
  cwd: path.join(THIS_DIR, '..', 'public', 'pagila'),
})

console.log('Done!')
