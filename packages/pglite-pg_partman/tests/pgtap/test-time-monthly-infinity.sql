-- ########## TIME MONTHLY ##########
-- Other tests:
    -- Ignoring infinity values in default

\set ON_ERROR_ROLLBACK 1
\set ON_ERROR_STOP true

BEGIN;
SELECT set_config('search_path','partman, public',false);

SELECT plan(17);
CREATE SCHEMA partman_test;

CREATE TABLE partman_test.time_taptest_table
    (col1 int
     , col2 text
     , col3 timestamptz DEFAULT now() NOT NULL)
    PARTITION BY RANGE (col3);
CREATE TABLE partman_test.undo_taptest (LIKE partman_test.time_taptest_table INCLUDING ALL);

CREATE INDEX ON partman_test.time_taptest_table (col3);

SELECT create_partition('partman_test.time_taptest_table', 'col3', '1 month');

INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(1,10), CURRENT_TIMESTAMP);

SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP), 'YYYYMMDD'), 'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP), 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'1 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'1 month'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'2 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'2 month'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'3 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'3 month'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'4 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'4 month'::interval, 'YYYYMMDD')||' exists');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'5 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'5 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'1 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'1 month'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'2 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'2 month'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'3 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'3 month'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'4 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'4 month'::interval, 'YYYYMMDD')||' exists');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'5 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'5 month'::interval, 'YYYYMMDD')||' does not exist');



INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(11,20), 'infinity');
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(21,30), '-infinity');
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(31,40), CURRENT_TIMESTAMP + '12 month'::interval);

SELECT run_maintenance();


SELECT results_eq('SELECT count(*)::int FROM partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP), 'YYYYMMDD'),
    ARRAY[10], 'Check count from time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP), 'YYYYMMDD'));

SELECT results_eq('SELECT count(*)::int FROM partman_test.time_taptest_table_default',
    ARRAY[30], 'Check infinity count from time_taptest_table_default');

SELECT results_eq('SELECT partition_data_time(''partman_test.time_taptest_table''::text, p_batch_count := 10, p_ignore_infinity := true)::int', ARRAY[10], 'Check that partition_data_time with ignore infinity true returns only 10.');

SELECT results_eq('SELECT partition_data_time(''partman_test.time_taptest_table''::text, p_batch_count := 10, p_ignore_infinity := true)::int', ARRAY[0], 'Check that partition_data_time with ignore infinity true returns only 0.');

SELECT results_eq('SELECT count::int FROM partman.check_default() WHERE default_table = ''partman_test.time_taptest_table_default''', ARRAY[20], 'Ensure that check_default with infinite false returns expected value of 20');

SELECT is_empty('SELECT count::int FROM partman.check_default(p_ignore_infinity := true) WHERE default_table = ''partman_test.time_taptest_table_default''', 'Ensure that check_default with infinite false returns NULL');

SELECT * FROM finish();
ROLLBACK;
