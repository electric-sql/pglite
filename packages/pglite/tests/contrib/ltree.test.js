import test from 'ava'
import { PGlite } from '../../dist/index.js'
import { ltree } from '../../dist/contrib/ltree.js'

test('ltree', async (t) => {
  const pg = new PGlite({
    extensions: {
      ltree,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS ltree;')

  await pg.exec(`
    CREATE TABLE test (path ltree);
    INSERT INTO test VALUES ('Top');
    INSERT INTO test VALUES ('Top.Science');
    INSERT INTO test VALUES ('Top.Science.Astronomy');
    INSERT INTO test VALUES ('Top.Science.Astronomy.Astrophysics');
    INSERT INTO test VALUES ('Top.Science.Astronomy.Cosmology');
    INSERT INTO test VALUES ('Top.Hobbies');
    INSERT INTO test VALUES ('Top.Hobbies.Amateurs_Astronomy');
    INSERT INTO test VALUES ('Top.Collections');
    INSERT INTO test VALUES ('Top.Collections.Pictures');
    INSERT INTO test VALUES ('Top.Collections.Pictures.Astronomy');
    INSERT INTO test VALUES ('Top.Collections.Pictures.Astronomy.Stars');
    INSERT INTO test VALUES ('Top.Collections.Pictures.Astronomy.Galaxies');
    INSERT INTO test VALUES ('Top.Collections.Pictures.Astronomy.Astronauts');
    CREATE INDEX path_gist_idx ON test USING GIST (path);
    CREATE INDEX path_idx ON test USING BTREE (path);
  `)

  const ret = await pg.query(`
    SELECT path FROM test WHERE path <@ 'Top.Science';
  `)

  t.deepEqual(ret.rows, [
    { path: 'Top.Science' },
    { path: 'Top.Science.Astronomy' },
    { path: 'Top.Science.Astronomy.Astrophysics' },
    { path: 'Top.Science.Astronomy.Cosmology' },
  ])
})
