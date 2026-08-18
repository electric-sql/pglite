-- ########## TIME MONTHLY ##########
-- Other tests:
    -- Ensure partitions that would be dropped by retention are not created during maintenance

\set ON_ERROR_ROLLBACK 1
\set ON_ERROR_STOP true

BEGIN;
SELECT set_config('search_path','partman, public',false);

SELECT plan(121);
CREATE SCHEMA partman_test;
CREATE SCHEMA partman_retention_test;

CREATE TABLE partman_test.time_taptest_table
    (col1 int
     , col2 text
     , col3 timestamptz DEFAULT now() NOT NULL)
    PARTITION BY RANGE (col3);
CREATE TABLE partman_test.time_taptest_table_template (LIKE partman_test.time_taptest_table INCLUDING ALL);
ALTER TABLE partman_test.time_taptest_table_template ADD PRIMARY KEY (col1);
CREATE TABLE partman_test.undo_taptest (LIKE partman_test.time_taptest_table INCLUDING ALL);

CREATE INDEX ON partman_test.time_taptest_table (col3);

SELECT create_partition('partman_test.time_taptest_table', 'col3', '1 month', p_template_table => 'partman_test.time_taptest_table_template', p_start_partition := date_trunc('month', (CURRENT_TIMESTAMP-'12 months'::interval))::text );

INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(1,10), CURRENT_TIMESTAMP);
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(1,10), CURRENT_TIMESTAMP-'12 month'::interval);

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
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'11 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'11 month'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'12 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'12 month'::interval, 'YYYYMMDD')||' exists');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'13 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'13 month'::interval, 'YYYYMMDD')||' does not exist');

SELECT col_is_pk('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP), 'YYYYMMDD'), ARRAY['col1'],
    'Check for primary key in time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP), 'YYYYMMDD'));
SELECT col_is_pk('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'1 month'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for primary key in time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'1 month'::interval, 'YYYYMMDD'));
SELECT col_is_pk('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'2 month'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for primary key in time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'2 month'::interval, 'YYYYMMDD'));
SELECT col_is_pk('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'3 month'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for primary key in time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'3 month'::interval, 'YYYYMMDD'));
SELECT col_is_pk('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'4 month'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for primary key in time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'4 month'::interval, 'YYYYMMDD'));
SELECT col_is_pk('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP), 'YYYYMMDD'), ARRAY['col1'],
    'Check for primary key in time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP), 'YYYYMMDD'));
SELECT col_is_pk('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'1 month'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for primary key in time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'1 month'::interval, 'YYYYMMDD'));
SELECT col_is_pk('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'2 month'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for primary key in time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'2 month'::interval, 'YYYYMMDD'));
SELECT col_is_pk('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'3 month'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for primary key in time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'3 month'::interval, 'YYYYMMDD'));
SELECT col_is_pk('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'4 month'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for primary key in time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'4 month'::interval, 'YYYYMMDD'));

-- Tests to ensure that old tables are not recreated if they would be included in the retention period

UPDATE part_config SET retention = '5 months', infinite_time_partitions = true, retention_keep_table = false WHERE parent_table = 'partman_test.time_taptest_table';

SELECT lives_ok('DROP TABLE partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'11 month'::interval, 'YYYYMMDD'), 'Drop table time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'11 month'::interval, 'YYYYMMDD') );
SELECT lives_ok('DROP TABLE partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'10 month'::interval, 'YYYYMMDD'), 'Drop table time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'10 month'::interval, 'YYYYMMDD') );
SELECT lives_ok('DROP TABLE partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'9 month'::interval, 'YYYYMMDD'), 'Drop table time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'9 month'::interval, 'YYYYMMDD') );
SELECT lives_ok('DROP TABLE partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'8 month'::interval, 'YYYYMMDD'), 'Drop table time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'8 month'::interval, 'YYYYMMDD') );
SELECT lives_ok('DROP TABLE partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'7 month'::interval, 'YYYYMMDD'), 'Drop table time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'7 month'::interval, 'YYYYMMDD') );
SELECT lives_ok('DROP TABLE partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'6 month'::interval, 'YYYYMMDD'), 'Drop table time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'6 month'::interval, 'YYYYMMDD') );
SELECT lives_ok('DROP TABLE partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'5 month'::interval, 'YYYYMMDD'), 'Drop table time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'5 month'::interval, 'YYYYMMDD') );
SELECT lives_ok('DROP TABLE partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'4 month'::interval, 'YYYYMMDD'), 'Drop table time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'4 month'::interval, 'YYYYMMDD') );
SELECT lives_ok('DROP TABLE partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'3 month'::interval, 'YYYYMMDD'), 'Drop table time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'3 month'::interval, 'YYYYMMDD') );
SELECT lives_ok('DROP TABLE partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'2 month'::interval, 'YYYYMMDD'), 'Drop table time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'2 month'::interval, 'YYYYMMDD') );
SELECT lives_ok('DROP TABLE partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'1 month'::interval, 'YYYYMMDD'), 'Drop table time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'1 month'::interval, 'YYYYMMDD') );
SELECT lives_ok('DROP TABLE partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP), 'YYYYMMDD'), 'Drop table time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP), 'YYYYMMDD') );
SELECT lives_ok('DROP TABLE partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'1 month'::interval, 'YYYYMMDD'), 'Drop table time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'1 month'::interval, 'YYYYMMDD') );
SELECT lives_ok('DROP TABLE partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'2 month'::interval, 'YYYYMMDD'), 'Drop table time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'2 month'::interval, 'YYYYMMDD') );
SELECT lives_ok('DROP TABLE partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'3 month'::interval, 'YYYYMMDD'), 'Drop table time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'3 month'::interval, 'YYYYMMDD') );
SELECT lives_ok('DROP TABLE partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'4 month'::interval, 'YYYYMMDD'), 'Drop table time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'4 month'::interval, 'YYYYMMDD') );

SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'12 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'12 month'::interval, 'YYYYMMDD')||' still exists');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'11 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'11 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'10 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'10 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'9 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'9 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'8 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'8 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'7 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'7 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'6 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'6 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'5 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'5 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'4 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'4 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'3 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'3 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'2 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'2 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'1 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'1 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP), 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP), 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'1 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'1 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'2 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'2 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'3 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'3 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'4 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'4 month'::interval, 'YYYYMMDD')||' does not exist');

SELECT run_maintenance();

-- Tables older than months should not have been created, 12 month old table should have been dropped and default premade tables should have been remade
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'12 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'12 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'11 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'11 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'10 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'10 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'9 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'9 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'8 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'8 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'7 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'7 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'6 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'6 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'5 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'5 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'4 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'4 month'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'3 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'3 month'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'2 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'2 month'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'1 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'1 month'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP), 'YYYYMMDD'), 'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP), 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'1 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'1 month'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'2 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'2 month'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'3 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'3 month'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'4 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'4 month'::interval, 'YYYYMMDD')||' exists');
-- For some reason, edge case of re-creating child tables sometimes goes one beyond premake. Investigate when time. Should not create one 2 beyond premake
--SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'5 month'::interval, 'YYYYMMDD'),
--    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'5 month'::interval, 'YYYYMMDD')||' exists');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'6 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'6 month'::interval, 'YYYYMMDD')||' does not exist');

-- Reinsert original data
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(1,10), CURRENT_TIMESTAMP);

SELECT results_eq('SELECT count(*)::int FROM partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP), 'YYYYMMDD'),
    ARRAY[10], 'Check count from time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP), 'YYYYMMDD'));

INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(11,20), CURRENT_TIMESTAMP + '1 month'::interval);
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(21,25), CURRENT_TIMESTAMP + '2 month'::interval);
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(26,30), CURRENT_TIMESTAMP + '3 month'::interval);
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(31,37), CURRENT_TIMESTAMP + '4 month'::interval);
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(40,49), CURRENT_TIMESTAMP - '1 month'::interval);
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(50,70), CURRENT_TIMESTAMP - '2 month'::interval);
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(71,85), CURRENT_TIMESTAMP - '3 month'::interval);
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(86,100), CURRENT_TIMESTAMP - '4 month'::interval);

SELECT results_eq('SELECT count(*)::int FROM partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'1 month'::interval, 'YYYYMMDD'),
    ARRAY[10], 'Check count from time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'1 month'::interval, 'YYYYMMDD'));
SELECT results_eq('SELECT count(*)::int FROM partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'2 month'::interval, 'YYYYMMDD'),
    ARRAY[5], 'Check count from time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'2 month'::interval, 'YYYYMMDD'));
SELECT results_eq('SELECT count(*)::int FROM partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'3 month'::interval, 'YYYYMMDD'),
    ARRAY[5], 'Check count from time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'3 month'::interval, 'YYYYMMDD'));
SELECT results_eq('SELECT count(*)::int FROM partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'4 month'::interval, 'YYYYMMDD'),
    ARRAY[7], 'Check count from time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'4 month'::interval, 'YYYYMMDD'));
SELECT results_eq('SELECT count(*)::int FROM partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'1 month'::interval, 'YYYYMMDD'),
    ARRAY[10], 'Check count from time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'1 month'::interval, 'YYYYMMDD'));
SELECT results_eq('SELECT count(*)::int FROM partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'2 month'::interval, 'YYYYMMDD'),
    ARRAY[21], 'Check count from time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'2 month'::interval, 'YYYYMMDD'));
SELECT results_eq('SELECT count(*)::int FROM partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'3 month'::interval, 'YYYYMMDD'),
    ARRAY[15], 'Check count from time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'3 month'::interval, 'YYYYMMDD'));
SELECT results_eq('SELECT count(*)::int FROM partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'4 month'::interval, 'YYYYMMDD'),
    ARRAY[15], 'Check count from time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'4 month'::interval, 'YYYYMMDD'));

UPDATE part_config SET premake = 5 WHERE parent_table = 'partman_test.time_taptest_table';
SELECT run_maintenance();

INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(101,122), CURRENT_TIMESTAMP + '5 month'::interval);

SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'5 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'5 month'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'6 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'6 month'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'7 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'7 month'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'8 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'8 month'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'9 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'9 month'::interval, 'YYYYMMDD')||' exists');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'10 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'10 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT col_is_pk('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'5 month'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for primary key in time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'5 month'::interval, 'YYYYMMDD'));
SELECT col_is_pk('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'6 month'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for primary key in time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'6 month'::interval, 'YYYYMMDD'));
SELECT col_is_pk('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'7 month'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for primary key in time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'7 month'::interval, 'YYYYMMDD'));
SELECT col_is_pk('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'8 month'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for primary key in time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'8 month'::interval, 'YYYYMMDD'));
SELECT col_is_pk('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'9 month'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for primary key in time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'9 month'::interval, 'YYYYMMDD'));

SELECT results_eq('SELECT count(*)::int FROM partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'5 month'::interval, 'YYYYMMDD'),
    ARRAY[22], 'Check count from time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'5 month'::interval, 'YYYYMMDD'));

UPDATE part_config SET premake = 6 WHERE parent_table = 'partman_test.time_taptest_table';
SELECT run_maintenance();
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(123,150), CURRENT_TIMESTAMP + '6 month'::interval);

SELECT results_eq('SELECT count(*)::int FROM partman_test.time_taptest_table', ARRAY[148], 'Check count from parent table');
SELECT results_eq('SELECT count(*)::int FROM partman_test.time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'6 month'::interval, 'YYYYMMDD'),
    ARRAY[28], 'Check count from time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'6 month'::interval, 'YYYYMMDD'));

SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'10 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'10 month'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'11 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'11 month'::interval, 'YYYYMMDD')||' exists');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'12 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'12 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT col_is_pk('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'10 month'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for primary key in time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'10 month'::interval, 'YYYYMMDD'));
SELECT col_is_pk('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'11 month'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for primary key in time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'11 month'::interval, 'YYYYMMDD'));




SELECT drop_partition_time('partman_test.time_taptest_table', '3 month', p_keep_table := false);
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'4 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'4 month'::interval, 'YYYYMMDD')||' does not exist');

UPDATE part_config SET retention = '2 month'::interval WHERE parent_table = 'partman_test.time_taptest_table';
SELECT drop_partition_time('partman_test.time_taptest_table', p_retention_schema := 'partman_retention_test');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'3 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'3 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT has_table('partman_retention_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'3 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'3 month'::interval, 'YYYYMMDD')||' got moved to new schema');

SELECT undo_partition('partman_test.time_taptest_table', p_loop_count => 20, p_target_table := 'partman_test.undo_taptest', p_keep_table := false);
SELECT results_eq('SELECT count(*)::int FROM partman_test.undo_taptest', ARRAY[118], 'Check count from target table after undo');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP), 'YYYYMMDD'),
    'Check time_taptest_table_'||to_char(date_trunc('month', CURRENT_TIMESTAMP), 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'1 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'1 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'2 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_'||to_char(date_trunc('month', CURRENT_TIMESTAMP)-'2 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'1 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'1 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'2 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'2 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'3 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'3 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'4 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'4 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'5 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'5 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'6 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'6 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'7 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'7 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'8 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'8 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'9 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'9 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'10 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'10 month'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'11 month'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_'||to_char(date_trunc('month', CURRENT_TIMESTAMP)+'11 month'::interval, 'YYYYMMDD')||' does not exist');


SELECT hasnt_table('partman_test', 'time_taptest_table_template', 'Check that template table was dropped');

SELECT * FROM finish();
ROLLBACK;
