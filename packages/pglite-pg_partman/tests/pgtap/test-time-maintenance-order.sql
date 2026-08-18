-- ########## TIME DAILY TESTS ##########
-- Other tests:
    -- Test that maintenance ordering works
    -- Ensure that NULLs are last in order

\set ON_ERROR_ROLLBACK 1
\set ON_ERROR_STOP true

BEGIN;
SELECT set_config('search_path','partman, public',false);

SELECT plan(4);

CREATE SCHEMA partman_test;

CREATE TABLE partman_test.time_taptest_table1
    (col1 int
        , col2 text default 'stuff'
        , col3 timestamptz NOT NULL DEFAULT now())
    PARTITION BY RANGE (col3);

CREATE TABLE partman_test.time_taptest_table2
    (col1 int
        , col2 text default 'stuff'
        , col3 timestamptz NOT NULL DEFAULT now())
    PARTITION BY RANGE (col3);

CREATE TABLE partman_test.time_taptest_table3
    (col1 int
        , col2 text default 'stuff'
        , col3 timestamptz NOT NULL DEFAULT now())
    PARTITION BY RANGE (col3);

SELECT create_partition('partman_test.time_taptest_table1', 'col3', '1 day');
SELECT create_partition('partman_test.time_taptest_table2', 'col3', '1 day');
SELECT create_partition('partman_test.time_taptest_table3', 'col3', '1 day');

SELECT is_partitioned('partman_test', 'time_taptest_table1', 'Check that time_taptest_table1 is natively partitioned');
SELECT is_partitioned('partman_test', 'time_taptest_table2', 'Check that time_taptest_table2 is natively partitioned');
SELECT is_partitioned('partman_test', 'time_taptest_table3', 'Check that time_taptest_table3 is natively partitioned');

UPDATE part_config SET maintenance_order = 1 WHERE parent_table = 'partman_test.time_taptest_table1';
UPDATE part_config SET maintenance_order = 2 WHERE parent_table = 'partman_test.time_taptest_table2';

SELECT run_maintenance();

SELECT results_eq(
    'SELECT parent_table FROM partman.part_config WHERE parent_table IN (''partman_test.time_taptest_table1'',''partman_test.time_taptest_table2'',''partman_test.time_taptest_table3'') ORDER BY maintenance_last_run ASC',
    'SELECT parent_table FROM partman.part_config WHERE parent_table IN (''partman_test.time_taptest_table1'',''partman_test.time_taptest_table2'',''partman_test.time_taptest_table3'') ORDER BY parent_table ASC',
    'Check that maintenance ran in order');

SELECT * FROM finish();
ROLLBACK;
