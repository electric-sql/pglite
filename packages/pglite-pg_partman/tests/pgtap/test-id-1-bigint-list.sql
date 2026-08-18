-- ########## ID LIST TESTS (increment 1) ##########
-- Additional tests:
    -- pre-created template table and passing to create_partition. Should allow indexes to be made for initial children.
    -- bigint (to account for difference in int vs bigint in partition expression)

\set ON_ERROR_ROLLBACK 1
\set ON_ERROR_STOP true

BEGIN;
SELECT set_config('search_path','partman, public',false);

SELECT plan(61);
CREATE SCHEMA partman_test;
CREATE SCHEMA partman_retention_test;

CREATE TABLE partman_test.id_taptest_table
    (col1 bigint
        , col2 bigint NOT NULL
        , col3 timestamptz DEFAULT now()
        , col4 text)
    PARTITION BY LIST (col2);
CREATE TABLE partman_test.undo_taptest (LIKE partman_test.id_taptest_table INCLUDING ALL);
-- Template table
CREATE TABLE partman_test.template_id_taptest_table (LIKE partman_test.id_taptest_table);
ALTER TABLE partman_test.template_id_taptest_table ADD PRIMARY KEY (col1);
CREATE INDEX ON partman_test.id_taptest_table (col2);

SELECT create_partition('partman_test.id_taptest_table', 'col2', '1', 'list', p_template_table := 'partman_test.template_id_taptest_table');
UPDATE part_config SET inherit_privileges = TRUE;
SELECT reapply_privileges('partman_test.id_taptest_table');

INSERT INTO partman_test.id_taptest_table (col1, col2, col4) VALUES (generate_series(0,9),0, 'stuff'||generate_series(0,9));
INSERT INTO partman_test.id_taptest_table (col1, col2, col4) VALUES (generate_series(10,19),1, 'stuff'||generate_series(10,19));
INSERT INTO partman_test.id_taptest_table (col1, col2, col4) VALUES (generate_series(20,29),2, 'stuff'||generate_series(20,29));
INSERT INTO partman_test.id_taptest_table (col1, col2, col4) VALUES (generate_series(30,39),3, 'stuff'||generate_series(30,39));
INSERT INTO partman_test.id_taptest_table (col1, col2, col4) VALUES (generate_series(40,49),4, 'stuff'||generate_series(40,49));

SELECT has_table('partman_test', 'id_taptest_table_p0', 'Check id_taptest_table_p0 exists');
SELECT has_table('partman_test', 'id_taptest_table_p1', 'Check id_taptest_table_p1 exists');
SELECT has_table('partman_test', 'id_taptest_table_p2', 'Check id_taptest_table_p2 exists');
SELECT has_table('partman_test', 'id_taptest_table_p3', 'Check id_taptest_table_p3 exists');
SELECT has_table('partman_test', 'id_taptest_table_p4', 'Check id_taptest_table_p4 exists');
SELECT has_table('partman_test', 'id_taptest_table_default', 'Check id_taptest_table_default exists');
SELECT hasnt_table('partman_test', 'id_taptest_table_p5', 'Check id_taptest_table_p5 doesn''t exists yet');
SELECT col_is_pk('partman_test', 'id_taptest_table_p0', ARRAY['col1'], 'Check for primary key in id_taptest_table_p3');
SELECT col_is_pk('partman_test', 'id_taptest_table_p1', ARRAY['col1'], 'Check for primary key in id_taptest_table_p3');
SELECT col_is_pk('partman_test', 'id_taptest_table_p2', ARRAY['col1'], 'Check for primary key in id_taptest_table_p3');
SELECT col_is_pk('partman_test', 'id_taptest_table_p3', ARRAY['col1'], 'Check for primary key in id_taptest_table_p3');
SELECT col_is_pk('partman_test', 'id_taptest_table_p4', ARRAY['col1'], 'Check for primary key in id_taptest_table_p3');
SELECT col_is_pk('partman_test', 'id_taptest_table_default', ARRAY['col1'], 'Check for primary key in id_taptest_table_default');

SELECT is_empty('SELECT * FROM ONLY partman_test.id_taptest_table_default', 'Check that default table has no data');
SELECT results_eq('SELECT count(*)::int FROM partman_test.id_taptest_table', ARRAY[50], 'Check count from parent table');
SELECT results_eq('SELECT count(*)::int FROM partman_test.id_taptest_table_p0', ARRAY[10], 'Check count from id_taptest_table_p0');

SELECT run_maintenance();
INSERT INTO partman_test.id_taptest_table (col1, col2, col4) VALUES (generate_series(50,59),5, 'stuff'||generate_series(50,59));
-- Run again to make new partition based on latest data
SELECT run_maintenance();

SELECT is_empty('SELECT * FROM ONLY partman_test.id_taptest_table', 'Check that parent table has had no data inserted to it');
SELECT results_eq('SELECT count(*)::int FROM partman_test.id_taptest_table_p1', ARRAY[10], 'Check count from id_taptest_table_p1');
SELECT results_eq('SELECT count(*)::int FROM partman_test.id_taptest_table_p2', ARRAY[10], 'Check count from id_taptest_table_p2');

SELECT has_table('partman_test', 'id_taptest_table_p5', 'Check id_taptest_table_p5 exists');
SELECT has_table('partman_test', 'id_taptest_table_p6', 'Check id_taptest_table_p6 exists yet');
SELECT has_table('partman_test', 'id_taptest_table_p7', 'Check id_taptest_table_p6 exists yet');
SELECT has_table('partman_test', 'id_taptest_table_p8', 'Check id_taptest_table_p6 exists yet');
SELECT has_table('partman_test', 'id_taptest_table_p9', 'Check id_taptest_table_p6 exists yet');
SELECT hasnt_table('partman_test', 'id_taptest_table_p10', 'Check id_taptest_table_p10 doesn''t exists yet');
SELECT col_is_pk('partman_test', 'id_taptest_table_p5', ARRAY['col1'], 'Check for primary key in id_taptest_table_p5');
SELECT col_is_pk('partman_test', 'id_taptest_table_p6', ARRAY['col1'], 'Check for primary key in id_taptest_table_p6');
SELECT col_is_pk('partman_test', 'id_taptest_table_p7', ARRAY['col1'], 'Check for primary key in id_taptest_table_p7');
SELECT col_is_pk('partman_test', 'id_taptest_table_p8', ARRAY['col1'], 'Check for primary key in id_taptest_table_p8');
SELECT col_is_pk('partman_test', 'id_taptest_table_p9', ARRAY['col1'], 'Check for primary key in id_taptest_table_p9');

INSERT INTO partman_test.id_taptest_table (col1, col2, col4) VALUES (generate_series(60,69),6, 'stuff'||generate_series(60,69));

SELECT run_maintenance();

SELECT is_empty('SELECT * FROM partman_test.id_taptest_table_default', 'Check that default table has had no data inserted to it');
SELECT results_eq('SELECT count(*)::int FROM partman_test.id_taptest_table', ARRAY[70], 'Check count from id_taptest_table');
SELECT results_eq('SELECT count(*)::int FROM partman_test.id_taptest_table_p5', ARRAY[10], 'Check count from id_taptest_table_p5');
SELECT results_eq('SELECT count(*)::int FROM partman_test.id_taptest_table_p6', ARRAY[10], 'Check count from id_taptest_table_p6');

SELECT has_table('partman_test', 'id_taptest_table_p10', 'Check id_taptest_table_p10 exists');
SELECT hasnt_table('partman_test', 'id_taptest_table_p11', 'Check id_taptest_table_p11 doesn''t exists yet');
SELECT col_is_pk('partman_test', 'id_taptest_table_p10', ARRAY['col1'], 'Check for primary key in id_taptest_table_p10');

INSERT INTO partman_test.id_taptest_table (col1, col2, col4) VALUES (generate_series(200,210),200, 'stuff'||generate_series(200,200));
SELECT results_eq('SELECT count(*)::int FROM ONLY partman_test.id_taptest_table_default', ARRAY[11], 'Check that data outside child scope goes to default');
SELECT run_maintenance();

-- Max value is 6 above (not including default)
SELECT drop_partition_id('partman_test.id_taptest_table', '4', p_keep_table := false);
SELECT hasnt_table('partman_test', 'id_taptest_table_p0', 'Check id_taptest_table_p0 doesn''t exists anymore');
SELECT hasnt_table('partman_test', 'id_taptest_table_p1', 'Check id_taptest_table_p1 doesn''t exists anymore');
SELECT has_table('partman_test', 'id_taptest_table_p2', 'Check id_taptest_table_p2 still exists');

UPDATE part_config SET retention = '3', retention_keep_table = 'false' WHERE parent_table = 'partman_test.id_taptest_table';
SELECT drop_partition_id('partman_test.id_taptest_table');
SELECT hasnt_table('partman_test', 'id_taptest_table_p2', 'Check id_taptest_table_p2 doesn''t exists anymore');
SELECT has_table('partman_test', 'id_taptest_table_p3', 'Check id_taptest_table_p3 still exists');

-- Undo will remove default first if it exists and has data. Don't keep default
SELECT undo_partition('partman_test.id_taptest_table', 'partman_test.undo_taptest', p_keep_table := false);
SELECT hasnt_table('partman_test', 'id_taptest_table_default', 'Check id_taptest_table_default does not exist');

-- Test undo removing one more table but keeping that data
SELECT undo_partition('partman_test.id_taptest_table', 'partman_test.undo_taptest', p_keep_table := false);
SELECT hasnt_table('partman_test', 'id_taptest_table_p3', 'Check id_taptest_table_p3 does not exist');

-- Test keeping the rest of the tables
SELECT undo_partition('partman_test.id_taptest_table', 'partman_test.undo_taptest', 10);
SELECT results_eq('SELECT count(*)::int FROM ONLY partman_test.undo_taptest', ARRAY[51], 'Check count from undo table after undo');
SELECT has_table('partman_test', 'id_taptest_table_p4', 'Check id_taptest_table_p4 still exists');
SELECT is_empty('SELECT * FROM partman_test.id_taptest_table_p4', 'Check child table had its data removed id_taptest_table_p4');
SELECT has_table('partman_test', 'id_taptest_table_p5', 'Check id_taptest_table_p5 still exists');
SELECT is_empty('SELECT * FROM partman_test.id_taptest_table_p5', 'Check child table had its data removed id_taptest_table_p5');
SELECT has_table('partman_test', 'id_taptest_table_p6', 'Check id_taptest_table_p6 still exists');
SELECT is_empty('SELECT * FROM partman_test.id_taptest_table_p6', 'Check child table had its data removed id_taptest_table_p6');
SELECT has_table('partman_test', 'id_taptest_table_p7', 'Check id_taptest_table_p7 still exists');
SELECT is_empty('SELECT * FROM partman_test.id_taptest_table_p7', 'Check child table had its data removed id_taptest_table_p7');
SELECT has_table('partman_test', 'id_taptest_table_p8', 'Check id_taptest_table_p8 still exists');
SELECT is_empty('SELECT * FROM partman_test.id_taptest_table_p8', 'Check child table had its data removed id_taptest_table_p8');
SELECT has_table('partman_test', 'id_taptest_table_p9', 'Check id_taptest_table_p9 still exists');
SELECT is_empty('SELECT * FROM partman_test.id_taptest_table_p9', 'Check child table had its data removed id_taptest_table_p9');
SELECT has_table('partman_test', 'id_taptest_table_p10', 'Check id_taptest_table_p10 still exists');
SELECT is_empty('SELECT * FROM partman_test.id_taptest_table_p10', 'Check child table had its data removed id_taptest_table_p10');

SELECT hasnt_table('partman_test', 'template_id_taptest_table', 'Check that template table was dropped');

SELECT * FROM finish();
ROLLBACK;
