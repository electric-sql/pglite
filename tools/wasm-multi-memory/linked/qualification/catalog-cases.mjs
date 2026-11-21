// Each query returns one boolean. DDL and the feature assertion run on the same session.
const indexed = (method, predicate, column = 'integer') => [
  `CREATE TABLE sample (v ${column}); INSERT INTO sample VALUES (1),(2);
   CREATE INDEX sample_idx ON sample USING ${method}; SET enable_seqscan=off`,
  `SELECT array_agg(v) = ARRAY[2] FROM sample WHERE ${predicate}`,
  `SELECT v FROM sample WHERE ${predicate}`,
]
export const cases = {
  amcheck: [
    '',
    "SELECT bt_index_check('pg_class_oid_index', true) IS NOT NULL",
  ],
  bloom: indexed('bloom(v)', 'v=2'),
  btree_gin: indexed('gin(v)', 'v=2'),
  btree_gist: indexed('gist(v)', 'v=2'),
  citext: ['', "SELECT 'Hello'::citext = 'HELLO'::citext"],
  cube: ['', "SELECT cube_distance('(0,0)', '(3,4)') = 5"],
  dict_int: ['', "SELECT ts_lexize('intdict','40865854') = ARRAY['408658']"],
  dict_xsyn: [
    "ALTER TEXT SEARCH DICTIONARY xsyn (RULES='xsyn_sample')",
    "SELECT 'sn'=ANY(ts_lexize('xsyn','supernova'))",
  ],
  earthdistance: [
    '',
    'SELECT earth_distance(ll_to_earth(0,0),ll_to_earth(0,1)) BETWEEN 111000 AND 112000',
  ],
  file_fdw: [
    "CREATE SERVER fs FOREIGN DATA WRAPPER file_fdw; CREATE FOREIGN TABLE lines(line text) SERVER fs OPTIONS(filename '/pglite/bin/postgres', format 'text')",
    "SELECT line='PGlite is the best!' FROM lines",
  ],
  fuzzystrmatch: ['', "SELECT levenshtein('kitten','sitting')=3"],
  hstore: ['', "SELECT ('a=>b'::hstore -> 'a') = 'b'"],
  intarray: ['', 'SELECT uniq(sort(ARRAY[3,1,3])) = ARRAY[1,3]'],
  isn: ['', "SELECT isbn('978-0-393-04002-9')::text='0-393-04002-X'"],
  lo: [
    'CREATE TABLE objects(v lo); CREATE TRIGGER prune BEFORE UPDATE OR DELETE ON objects FOR EACH ROW EXECUTE FUNCTION lo_manage(v); INSERT INTO objects VALUES(lo_create(998001)); DELETE FROM objects',
    'SELECT NOT EXISTS(SELECT FROM pg_largeobject_metadata WHERE oid=998001)',
  ],
  ltree: ['', "SELECT 'Top.Science.Astronomy'::ltree <@ 'Top.Science'::ltree"],
  pageinspect: [
    'CREATE TABLE sample(v int); INSERT INTO sample VALUES(1)',
    "SELECT count(*)=1 FROM heap_page_items(get_raw_page('sample',0))",
  ],
  pg_buffercache: ['', 'SELECT buffers_used>0 FROM pg_buffercache_summary()'],
  pg_freespacemap: [
    'CREATE TABLE sample (v int); INSERT INTO sample VALUES (1)',
    "SELECT pg_freespace('sample',0)>=0",
  ],
  pg_stat_statements: [
    'SELECT 134 AS observed_constant',
    "SELECT EXISTS(SELECT FROM pg_stat_statements WHERE query LIKE '%AS observed_constant' AND calls>0)",
  ],
  pg_surgery: [
    "CREATE TABLE sample(v int); INSERT INTO sample VALUES(1); SELECT heap_force_kill('sample',ARRAY['(0,1)']::tid[])",
    'SELECT count(*)=0 FROM sample',
  ],
  pg_trgm: [
    "CREATE TABLE sample(v text); INSERT INTO sample VALUES('postgres'),('database'); CREATE INDEX sample_idx ON sample USING gin(v gin_trgm_ops); SET enable_seqscan=off",
    "SELECT array_agg(v)=ARRAY['postgres'] FROM sample WHERE v LIKE '%ostgr%'",
    "SELECT v FROM sample WHERE v LIKE '%ostgr%'",
  ],
  pg_visibility: [
    'CREATE TABLE sample (v int); INSERT INTO sample VALUES(1)',
    "SELECT count(*)=1 FROM pg_visibility_map('sample') WHERE blkno=0",
  ],
  pg_walinspect: [
    'CREATE TABLE sample(v int); CREATE TEMP TABLE wal_start AS SELECT pg_current_wal_lsn() AS lsn; INSERT INTO sample VALUES(1)',
    'SELECT count(*)>0 FROM wal_start, LATERAL pg_get_wal_block_info(lsn,pg_current_wal_lsn())',
  ],
  pgcrypto: [
    '',
    "SELECT encode(digest('abc','sha256'),'hex')='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'",
  ],
  seg: ['', "SELECT '7(+-)1'::seg::text='6 .. 8'"],
  tablefunc: ['', 'SELECT count(*)=10 FROM normal_rand(10,5,3)'],
  tsm_system_rows: [
    'CREATE TABLE sample AS SELECT generate_series(1,10) v',
    'SELECT count(*)=2 FROM sample TABLESAMPLE SYSTEM_ROWS(2)',
  ],
  tsm_system_time: [
    'CREATE TABLE sample AS SELECT generate_series(1,10) v',
    'SELECT count(*)=10 FROM sample TABLESAMPLE SYSTEM_TIME(10000)',
  ],
  unaccent: ['', "SELECT unaccent('Hôtel')='Hotel'"],
  'uuid-ossp': [
    '',
    "SELECT uuid_generate_v5(uuid_ns_dns(),'www.example.com')='2ed6657d-e927-568b-95e1-2665a8aea6a2'::uuid",
  ],
  age: [
    "LOAD 'age'; SET search_path=ag_catalog,public; SELECT create_graph('test_graph')",
    "SELECT v::text='7' FROM cypher('test_graph',$$ RETURN 3+4 $$) AS (v agtype)",
  ],
  pg_hashids: ['', "SELECT id_encode(1001)='jNl'"],
  pg_ivm: [
    "CREATE TABLE sample(v int); SELECT pgivm.create_immv('summary','SELECT sum(v) AS total FROM sample'); INSERT INTO sample VALUES(2),(3)",
    'SELECT total=5 FROM summary',
  ],
  pg_textsearch: [
    "CREATE TABLE docs(body text); CREATE INDEX docs_idx ON docs USING bm25(body) WITH (text_config='english'); INSERT INTO docs VALUES('hello world'),('quick brown fox')",
    "SELECT (SELECT body FROM docs ORDER BY body <@> to_bm25query('hello','docs_idx') LIMIT 1)='hello world'",
  ],
  pg_uuidv7: ['', 'SELECT uuid_extract_version(uuid_generate_v7())=7'],
  pgmq: [
    "SELECT pgmq.create('sample'); SELECT pgmq.send('sample','{\"v\":7}'::jsonb)",
    "SELECT message->>'v'='7' FROM pgmq.read('sample',30,1)",
  ],
  pgtap: ['SELECT plan(1)', "SELECT pass('sample')='ok 1 - sample'"],
  postgis: [
    'CREATE EXTENSION postgis_tiger_geocoder CASCADE; CREATE EXTENSION postgis_raster; CREATE EXTENSION postgis_topology; SET search_path=tiger,public',
    "SELECT (normalize_address('123 Main St, Boston, MA 02110')).zip='02110' AND abs(ST_X(ST_Transform(ST_SetSRID(ST_Point(1,0),4326),3857))-111319.49)<0.1 AND ST_Width(ST_MakeEmptyRaster(2,1,0,0,1,-1,0,0,4326))=2 AND topology.CreateTopology('test_topo',4326)>0",
  ],
  vector: ['', "SELECT '[1,2]'::vector <-> '[4,6]'::vector = 5"],
}
