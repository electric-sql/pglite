import { PGlite } from '../../../pglite/dist';
import { PGLiteSocketServer } from '../../src'
import { Client } from 'pg';
import { unlink } from 'fs/promises';
import { existsSync, readdir } from 'fs';

const SOCKET_PATH = '/tmp/.s.PGSQL.5432';

async function cleanup() {
  if (existsSync(SOCKET_PATH)) {
    try {
      await unlink(SOCKET_PATH);
      console.log(`Removed old socket at ${SOCKET_PATH}`);
    } catch (err) {}
  }
}

async function run() {
  // Create a PGlite instance
  const db = await PGlite.create();

  // Create and start a socket server
  cleanup();

  const server = new PGLiteSocketServer({
    db,
    path: SOCKET_PATH,
  });
  await server.start();
  console.log(`Server started on socket ${SOCKET_PATH}`);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await server.stop();
    await db.close();
    console.log('Server stopped and database closed');
    process.exit(0);
  });

  readdir('/tmp/', (err, files) => {
    files.forEach((file) => {
      console.log('file found:', file);
    });
  });

  // Create a new PostgreSQL client
  const client = new Client({
    host: '/tmp',
    user: 'postgres',
    database: 'postgres',
    password: 'postgres',
  });
  await client.connect();

  // Query!
  const result = await client.query('SELECT version()');
  console.log(result);

  await client.query(`
  CREATE TABLE IF NOT EXISTS test (
    id SERIAL PRIMARY KEY,
    name TEXT
  );
`);

  const multiStatementResult = await client.query(`
  INSERT INTO test (name) VALUES ('test');
  UPDATE test SET name = 'bulan';
  SELECT * FROM test;
  `);
  console.log(JSON.stringify(multiStatementResult));
}

run();
