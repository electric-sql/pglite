import { PGlite } from '../dist/index.js'
import { worker } from '../dist/worker/index.js'
import { vector } from '../dist/vector/index.js'

worker({
  async init() {
    const pg = new PGlite({
      extensions: {
        vector,
      },
    })
    // If you want run any specific setup code for the worker process, you can do it here.
    console.log('Creating table...')
    await pg.exec(`
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE TABLE IF NOT EXISTS test (
    id SERIAL PRIMARY KEY,
    data vector(3)
  );
`)    
    return pg
  },
})

console.log('Worker process started')
