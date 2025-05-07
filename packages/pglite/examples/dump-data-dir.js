import { PGlite } from '../dist/index.js'

const pg = new PGlite()
await pg.exec(`
  CREATE TABLE IF NOT EXISTS test (
    id SERIAL PRIMARY KEY,
    name TEXT
  );
`)
await pg.exec("INSERT INTO test (name) VALUES ('test');")

const file = await pg.dumpDataDir()

if (typeof window !== 'undefined') {
  // Download the dump
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
} else {
  // Save the dump to a file using node fs
  const fs = await import('fs')
  fs.writeFileSync(file.name, await file.arrayBuffer())
}

const pg2 = new PGlite({
  loadDataDir: file,
})

const rows = await pg2.query('SELECT * FROM test;')
console.log(rows)
