import { PGlite } from '../../dist/index.js'

const dataDir = process.argv[2]
if (!dataDir) throw new Error('missing data directory')

const pg = await PGlite.create(dataDir)
await pg.exec(`
  CREATE TABLE IF NOT EXISTS test (
    id SERIAL PRIMARY KEY,
    name TEXT
  );
`)
await pg.exec("INSERT INTO test (name) VALUES ('test');")
await pg.exec('DROP DATABASE IF EXISTS mypostgres;')
await pg.exec('CREATE DATABASE mypostgres TEMPLATE template1;')
process.send?.('ready')
setInterval(() => {}, 60_000)
