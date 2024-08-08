import test from 'ava'
import { PGlite } from '../../dist/index.js'
import { tablefunc } from '../../dist/contrib/tablefunc.js'

test('tablefunc', async (t) => {
  const pg = new PGlite({
    extensions: {
      tablefunc,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS tablefunc;')

  const ret = await pg.query(`SELECT * FROM normal_rand(10, 5, 3)`)
  t.deepEqual(ret.rows.length, 10)

  await pg.exec(`
    CREATE TABLE ct(id SERIAL, rowid TEXT, attribute TEXT, value TEXT);
    INSERT INTO ct(rowid, attribute, value) VALUES('test1','att1','val1');
    INSERT INTO ct(rowid, attribute, value) VALUES('test1','att2','val2');
    INSERT INTO ct(rowid, attribute, value) VALUES('test1','att3','val3');
    INSERT INTO ct(rowid, attribute, value) VALUES('test1','att4','val4');
    INSERT INTO ct(rowid, attribute, value) VALUES('test2','att1','val5');
    INSERT INTO ct(rowid, attribute, value) VALUES('test2','att2','val6');
    INSERT INTO ct(rowid, attribute, value) VALUES('test2','att3','val7');
    INSERT INTO ct(rowid, attribute, value) VALUES('test2','att4','val8');
  `)

  const ret2 = await pg.query(`
    SELECT *
    FROM crosstab(
      'select rowid, attribute, value
      from ct
      where attribute = ''att2'' or attribute = ''att3''
      order by 1,2')
    AS ct(row_name text, category_1 text, category_2 text, category_3 text);
  `)

  t.deepEqual(ret2.rows, [
    {
      row_name: 'test1',
      category_1: 'val2',
      category_2: 'val3',
      category_3: null,
    },
    {
      row_name: 'test2',
      category_1: 'val6',
      category_2: 'val7',
      category_3: null,
    },
  ])
})
