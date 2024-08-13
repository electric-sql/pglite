import test from '../polytest.js'
import { PGlite } from '../../dist/index.js'
import { MobileFS } from '../../dist/fs/mobilefs.js'
import * as FileSystem from 'expo-file-system'

test('MobileFS read, write, delete', async (t) => {
  const db = new PGlite({
    fs: new MobileFS(FileSystem.documentDirectory + 'pgdata'),
  })

  await db.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      name TEXT
    );
  `)

  await db.exec("INSERT INTO test (name) VALUES ('test');")

  const res = await db.query(`
    SELECT * FROM test;
  `)

  t.deepEqual(res, {
    rows: [
      {
        id: 1,
        name: 'test',
      },
    ],
    fields: [
      {
        name: 'id',
        dataTypeID: 23,
      },
      {
        name: 'name',
        dataTypeID: 25,
      },
    ],
    affectedRows: 0,
  })

  // Test reading file
  const filePath = FileSystem.documentDirectory + 'pgdata/test.txt'
  await FileSystem.writeAsStringAsync(filePath, 'Hello, world!')
  const fileContent = await FileSystem.readAsStringAsync(filePath)
  t.is(fileContent, 'Hello, world!')

  // Test deleting file
  await FileSystem.deleteAsync(filePath)
  const fileExists = await FileSystem.getInfoAsync(filePath)
  t.false(fileExists.exists)
})
