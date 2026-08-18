-- ########## TIME DAILY TESTS ##########
-- Other tests:
    -- Privilege inheritance
    -- check that maintenance catches up if tables are missing
    -- Test using default template table. Initial child tables will have no indexes or primary keys. New tables after template has indexes added should.
    -- Test for native FK inheritance
    -- Test that column statistics target is inherited from parent tables (this is only testing that the commands work. Actually testing that they're inherited is a different pattern match between 16 and 17. There is an actual test in the pg17plus folder)

\set ON_ERROR_ROLLBACK 1
\set ON_ERROR_STOP true

BEGIN;
SELECT set_config('search_path','partman, public',false);

SELECT plan(221);

CREATE ROLE partman_basic;
CREATE ROLE partman_revoke;
CREATE ROLE partman_owner;
CREATE SCHEMA partman_test;
CREATE SCHEMA partman_retention_test AUTHORIZATION partman_owner;

CREATE TABLE partman_test.fk_test_reference (col2 text unique not null);
INSERT INTO partman_test.fk_test_reference VALUES ('stuff');

CREATE TABLE partman_test.time_taptest_table
    (col1 int
        , col2 text default 'stuff'
        , col3 timestamptz NOT NULL DEFAULT now()
        , CONSTRAINT fk_test FOREIGN KEY (col2) REFERENCES partman_test.fk_test_reference(col2) )
    PARTITION BY RANGE (col3);
ALTER TABLE partman_test.time_taptest_table
    ALTER COLUMN col1 SET STATISTICS 1000,
    ALTER COLUMN col2 SET STATISTICS 0;
CREATE TABLE partman_test.undo_taptest (LIKE partman_test.time_taptest_table INCLUDING ALL);
GRANT SELECT,INSERT,UPDATE ON partman_test.time_taptest_table TO partman_basic;
GRANT ALL ON partman_test.time_taptest_table TO partman_revoke;
ALTER TABLE partman_test.time_taptest_table OWNER TO partman_owner;

SELECT create_partition('partman_test.time_taptest_table', 'col3', '1 day');
UPDATE part_config SET inherit_privileges = TRUE;
SELECT reapply_privileges('partman_test.time_taptest_table');

SELECT is_partitioned('partman_test', 'time_taptest_table', 'Check that time_taptest_table is natively partitioned');
SELECT has_table('partman', 'template_partman_test_time_taptest_table', 'Check that default template table was created');
SELECT table_owner_is ('partman', 'template_partman_test_time_taptest_table', 'partman_owner',
    'Check that template table ownership is set properly');

-- Add inheritable stuff to template table
ALTER TABLE template_partman_test_time_taptest_table ADD PRIMARY KEY (col1);

INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(1,10), CURRENT_TIMESTAMP);
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD'), 'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'1 day'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'1 day'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'2 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'2 days'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'3 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'3 days'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD')||' exists');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'5 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'5 days'::interval, 'YYYYMMDD')||' does not exist');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'1 day'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'1 day'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'2 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'2 days'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'3 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'3 days'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'4 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'4 days'::interval, 'YYYYMMDD')||' exists');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'5 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'5 days'::interval, 'YYYYMMDD')||' does not exist');

SELECT col_isnt_pk('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD'), ARRAY['col1'],
    'Check for NO primary key in time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD'));
SELECT col_isnt_pk('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'1 day'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for NO primary key in time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'1 day'::interval, 'YYYYMMDD'));
SELECT col_isnt_pk('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'2 days'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for NO primary key in time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'2 days'::interval, 'YYYYMMDD'));
SELECT col_isnt_pk('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'3 days'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for NO primary key in time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'3 days'::interval, 'YYYYMMDD'));
SELECT col_isnt_pk('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for NO primary key in time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD'));
SELECT col_isnt_pk('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD'), ARRAY['col1'],
    'Check for NO primary key in time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD'));
SELECT col_isnt_pk('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'1 day'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for NO primary key in time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'1 day'::interval, 'YYYYMMDD'));
SELECT col_isnt_pk('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'2 days'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for NO primary key in time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'2 days'::interval, 'YYYYMMDD'));
SELECT col_isnt_pk('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'3 days'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for NO primary key in time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'3 days'::interval, 'YYYYMMDD'));
SELECT col_isnt_pk('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'4 days'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for NO primary key in time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'4 days'::interval, 'YYYYMMDD'));

SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'1 day'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'1 day'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'2 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'2 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'3 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'3 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'1 day'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'1 day'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'2 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'2 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'3 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'3 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'4 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'4 days'::interval, 'YYYYMMDD'));

SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD'), 'partman_revoke',
    ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'],
    'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'1 day'::interval, 'YYYYMMDD'), 'partman_revoke',
    ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'],
    'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'1 day'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'2 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'],
    'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'2 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'3 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'],
    'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'3 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'],
    'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'1 day'::interval, 'YYYYMMDD'), 'partman_revoke',
    ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'],
    'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'1 day'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'2 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'],
    'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'2 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'3 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'],
    'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'3 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'4 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'],
    'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'4 days'::interval, 'YYYYMMDD'));


SELECT is_empty('SELECT * FROM ONLY partman_test.time_taptest_table', 'Check that parent table is empty. Should be impossible for native, but leaving test here just cause.');
SELECT results_eq('SELECT count(*)::int FROM partman_test.time_taptest_table', ARRAY[10], 'Check count from parent table');
SELECT results_eq('SELECT count(*)::int FROM partman_test.time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD'),
    ARRAY[10], 'Check count from time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD'));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON partman_test.time_taptest_table FROM partman_revoke;
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(11,20), CURRENT_TIMESTAMP + '1 day'::interval);
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(21,25), CURRENT_TIMESTAMP + '2 days'::interval);
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(26,30), CURRENT_TIMESTAMP + '3 days'::interval);
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(31,37), CURRENT_TIMESTAMP + '4 days'::interval);
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(40,49), CURRENT_TIMESTAMP - '1 day'::interval);
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(50,70), CURRENT_TIMESTAMP - '2 days'::interval);
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(71,85), CURRENT_TIMESTAMP - '3 days'::interval);
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(86,100), CURRENT_TIMESTAMP - '4 days'::interval);

SELECT is_empty('SELECT * FROM ONLY partman_test.time_taptest_table', 'Check that parent table has had no data inserted to it');
SELECT results_eq('SELECT count(*)::int FROM partman_test.time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'1 day'::interval, 'YYYYMMDD'),
    ARRAY[10], 'Check count from time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'1 day'::interval, 'YYYYMMDD'));
SELECT results_eq('SELECT count(*)::int FROM partman_test.time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'2 days'::interval, 'YYYYMMDD'),
    ARRAY[5], 'Check count from time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'2 days'::interval, 'YYYYMMDD'));
SELECT results_eq('SELECT count(*)::int FROM partman_test.time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'3 days'::interval, 'YYYYMMDD'),
    ARRAY[5], 'Check count from time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'3 days'::interval, 'YYYYMMDD'));
SELECT results_eq('SELECT count(*)::int FROM partman_test.time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD'),
    ARRAY[7], 'Check count from time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD'));
SELECT results_eq('SELECT count(*)::int FROM partman_test.time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'1 day'::interval, 'YYYYMMDD'),
    ARRAY[10], 'Check count from time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'1 day'::interval, 'YYYYMMDD'));
SELECT results_eq('SELECT count(*)::int FROM partman_test.time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'2 days'::interval, 'YYYYMMDD'),
    ARRAY[21], 'Check count from time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'2 days'::interval, 'YYYYMMDD'));
SELECT results_eq('SELECT count(*)::int FROM partman_test.time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'3 days'::interval, 'YYYYMMDD'),
    ARRAY[15], 'Check count from time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'3 days'::interval, 'YYYYMMDD'));
SELECT results_eq('SELECT count(*)::int FROM partman_test.time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'4 days'::interval, 'YYYYMMDD'),
    ARRAY[15], 'Check count from time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'4 days'::interval, 'YYYYMMDD'));

UPDATE part_config SET premake = 5 WHERE parent_table = 'partman_test.time_taptest_table';

-- Run to create proper future partitions
SELECT run_maintenance();
-- Insert after maintenance since native fails with no child
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(101,122), CURRENT_TIMESTAMP + '5 days'::interval);
-- Run again to create +5 partition now that data exists
SELECT run_maintenance();

-- Data exists for +5 days, with 5 premake so +10 day table should exist
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'5 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'5 days'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'6 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'6 days'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'7 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'7 days'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'8 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'8 days'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'9 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'9 days'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'10 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'10 days'::interval, 'YYYYMMDD')||' exists');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'11 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'11 days'::interval, 'YYYYMMDD')||' does not exist');

SELECT col_is_pk('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'5 days'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for primary key in time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'5 days'::interval, 'YYYYMMDD'));
SELECT col_is_pk('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'6 days'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for primary key in time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'6 days'::interval, 'YYYYMMDD'));
SELECT col_is_pk('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'7 days'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for primary key in time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'7 days'::interval, 'YYYYMMDD'));
SELECT col_is_pk('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'8 days'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for primary key in time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'8 days'::interval, 'YYYYMMDD'));
SELECT col_is_pk('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'9 days'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for primary key in time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'9 days'::interval, 'YYYYMMDD'));
SELECT col_is_pk('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'10 days'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for primary key in time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'10 days'::interval, 'YYYYMMDD'));

SELECT col_is_fk('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'5 days'::interval, 'YYYYMMDD'), ARRAY['col2'],
    'Check for foreign key in time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'5 days'::interval, 'YYYYMMDD')||'.');
SELECT col_is_fk('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'6 days'::interval, 'YYYYMMDD'), ARRAY['col2'],
    'Check for foreign key in time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'6 days'::interval, 'YYYYMMDD')||'.');
SELECT col_is_fk('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'7 days'::interval, 'YYYYMMDD'), ARRAY['col2'],
    'Check for foreign key in time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'7 days'::interval, 'YYYYMMDD')||'.');
SELECT col_is_fk('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'8 days'::interval, 'YYYYMMDD'), ARRAY['col2'],
    'Check for foreign key in time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'8 days'::interval, 'YYYYMMDD')||'.');
SELECT col_is_fk('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'9 days'::interval, 'YYYYMMDD'), ARRAY['col2'],
    'Check for foreign key in time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'9 days'::interval, 'YYYYMMDD')||'.');
SELECT col_is_fk('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'10 days'::interval, 'YYYYMMDD'), ARRAY['col2'],
    'Check for foreign key in time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'10 days'::interval, 'YYYYMMDD')||'.');


SELECT is_empty('SELECT * FROM ONLY partman_test.time_taptest_table', 'Check that parent table has had no data inserted to it');
SELECT results_eq('SELECT count(*)::int FROM partman_test.time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'5 days'::interval, 'YYYYMMDD'),
    ARRAY[22], 'Check count from time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'5 days'::interval, 'YYYYMMDD'));

SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD'), 'partman_basic', ARRAY['SELECT','INSERT','UPDATE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'1 day'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'1 day'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'2 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'2 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'3 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'3 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD'), 'partman_basic',
ARRAY['SELECT','INSERT','UPDATE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'1 day'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'1 day'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'2 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'2 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'3 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'3 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'4 days'::interval, 'YYYYMMDD'), 'partman_basic',
ARRAY['SELECT','INSERT','UPDATE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'4 days'::interval, 'YYYYMMDD'));

SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'5 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    ARRAY['SELECT'], 'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'5 days'::interval, 'YYYYMMDD'));

GRANT DELETE ON partman_test.time_taptest_table TO partman_basic;
REVOKE ALL ON partman_test.time_taptest_table FROM partman_revoke;

ALTER TABLE partman_test.time_taptest_table OWNER TO partman_owner;

UPDATE part_config SET premake = 6 WHERE parent_table = 'partman_test.time_taptest_table';
SELECT run_maintenance();
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(123,150), CURRENT_TIMESTAMP + '6 days'::interval);
-- Run again now that +6 data exists
SELECT run_maintenance();

SELECT is_empty('SELECT * FROM ONLY partman_test.time_taptest_table', 'Check that parent table has had no data inserted to it');
SELECT results_eq('SELECT count(*)::int FROM partman_test.time_taptest_table', ARRAY[148], 'Check count from parent table');
SELECT results_eq('SELECT count(*)::int FROM partman_test.time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'6 days'::interval, 'YYYYMMDD'),
    ARRAY[28], 'Check count from time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'6 days'::interval, 'YYYYMMDD'));

SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'11 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'11 days'::interval, 'YYYYMMDD')||' exists');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'12 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'12 days'::interval, 'YYYYMMDD')||' exists');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'13 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'13 days'::interval, 'YYYYMMDD')||' does not exist');

SELECT col_is_pk('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'11 days'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for primary key in time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'11 days'::interval, 'YYYYMMDD'));
SELECT col_is_pk('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'12 days'::interval, 'YYYYMMDD'), ARRAY['col1'],
    'Check for primary key in time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'12 days'::interval, 'YYYYMMDD'));

SELECT col_is_fk('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'11 days'::interval, 'YYYYMMDD'), ARRAY['col2'],
    'Check for foreign key in time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'11 days'::interval, 'YYYYMMDD')||'.');
SELECT col_is_fk('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'12 days'::interval, 'YYYYMMDD'), ARRAY['col2'],
    'Check for foreign key in time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'12 days'::interval, 'YYYYMMDD')||'.');


SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD'), 'partman_basic', ARRAY['SELECT','INSERT','UPDATE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'1 day'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'1 day'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'2 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'2 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'3 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'3 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'1 day'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'1 day'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'2 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'2 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'3 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'3 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'4 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'4 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'5 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    ARRAY['SELECT'], 'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'5 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'6 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    ARRAY['SELECT'], 'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'6 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'7 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    ARRAY['SELECT'], 'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'7 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'8 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    ARRAY['SELECT'], 'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'8 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'9 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    ARRAY['SELECT'], 'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'9 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'10 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    ARRAY['SELECT'], 'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'10 days'::interval, 'YYYYMMDD'));

SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'11 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE', 'DELETE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'11 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'12 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE', 'DELETE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'12 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'11 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    '{}'::text[], 'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'11 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'12 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    '{}'::text[], 'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'12 days'::interval, 'YYYYMMDD'));

SELECT table_owner_is ('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'11 days'::interval, 'YYYYMMDD'), 'partman_owner',
    'Check that ownership change worked for time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'11 days'::interval, 'YYYYMMDD'));
SELECT table_owner_is ('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'12 days'::interval, 'YYYYMMDD'), 'partman_owner',
    'Check that ownership change worked for time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'12 days'::interval, 'YYYYMMDD'));

SELECT reapply_privileges('partman_test.time_taptest_table');

SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE', 'DELETE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'1 day'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE', 'DELETE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'1 day'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'2 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE', 'DELETE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'2 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'3 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE', 'DELETE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'3 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE', 'DELETE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'5 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE', 'DELETE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'5 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'6 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE', 'DELETE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'6 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'7 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE', 'DELETE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'7 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'8 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE', 'DELETE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'8 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'9 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE', 'DELETE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'9 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'10 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE', 'DELETE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'10 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'11 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE', 'DELETE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'11 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'12 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE', 'DELETE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'12 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'1 day'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE', 'DELETE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'1 day'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'2 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE', 'DELETE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'2 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'3 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE', 'DELETE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'3 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'4 days'::interval, 'YYYYMMDD'), 'partman_basic',
    ARRAY['SELECT','INSERT','UPDATE', 'DELETE'],
    'Check partman_basic privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'4 days'::interval, 'YYYYMMDD'));

SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD'), 'partman_revoke',
    '{}'::text[], 'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'1 day'::interval, 'YYYYMMDD'), 'partman_revoke',
    '{}'::text[], 'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'1 day'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'2 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    '{}'::text[], 'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'2 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'3 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    '{}'::text[], 'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'3 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    '{}'::text[], 'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'5 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    '{}'::text[], 'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'5 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'6 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    '{}'::text[], 'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'6 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'7 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    '{}'::text[], 'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'7 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'8 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    '{}'::text[], 'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'8 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'9 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    '{}'::text[], 'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'9 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'10 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    '{}'::text[], 'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'10 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'11 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    '{}'::text[], 'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'11 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'12 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    '{}'::text[], 'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'12 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'1 day'::interval, 'YYYYMMDD'), 'partman_revoke',
    '{}'::text[], 'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'1 day'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'2 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    '{}'::text[], 'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'2 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'3 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    '{}'::text[], 'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'3 days'::interval, 'YYYYMMDD'));
SELECT table_privs_are('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'4 days'::interval, 'YYYYMMDD'), 'partman_revoke',
    '{}'::text[], 'Check partman_revoke privileges of time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'4 days'::interval, 'YYYYMMDD'));

SELECT table_owner_is ('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD'), 'partman_owner',
    'Check that ownership change worked for time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD'));
SELECT table_owner_is ('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'1 day'::interval, 'YYYYMMDD'), 'partman_owner',
    'Check that ownership change worked for time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'1 day'::interval, 'YYYYMMDD'));
SELECT table_owner_is ('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'2 days'::interval, 'YYYYMMDD'), 'partman_owner',
    'Check that ownership change worked for time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'2 days'::interval, 'YYYYMMDD'));
SELECT table_owner_is ('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'3 days'::interval, 'YYYYMMDD'), 'partman_owner',
    'Check that ownership change worked for time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'3 days'::interval, 'YYYYMMDD'));
SELECT table_owner_is ('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD'), 'partman_owner',
    'Check that ownership change worked for time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD'));
SELECT table_owner_is ('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'5 days'::interval, 'YYYYMMDD'), 'partman_owner',
    'Check that ownership change worked for time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'5 days'::interval, 'YYYYMMDD'));
SELECT table_owner_is ('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'6 days'::interval, 'YYYYMMDD'), 'partman_owner',
    'Check that ownership change worked for time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'6 days'::interval, 'YYYYMMDD'));
SELECT table_owner_is ('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'7 days'::interval, 'YYYYMMDD'), 'partman_owner',
    'Check that ownership change worked for time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'7 days'::interval, 'YYYYMMDD'));
SELECT table_owner_is ('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'8 days'::interval, 'YYYYMMDD'), 'partman_owner',
    'Check that ownership change worked for time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'8 days'::interval, 'YYYYMMDD'));
SELECT table_owner_is ('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'9 days'::interval, 'YYYYMMDD'), 'partman_owner',
    'Check that ownership change worked for time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'9 days'::interval, 'YYYYMMDD'));
SELECT table_owner_is ('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'10 days'::interval, 'YYYYMMDD'), 'partman_owner',
    'Check that ownership change worked for time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'10 days'::interval, 'YYYYMMDD'));
SELECT table_owner_is ('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'11 days'::interval, 'YYYYMMDD'), 'partman_owner',
    'Check that ownership change worked for time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'11 days'::interval, 'YYYYMMDD'));
SELECT table_owner_is ('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'12 days'::interval, 'YYYYMMDD'), 'partman_owner',
    'Check that ownership change worked for time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'12 days'::interval, 'YYYYMMDD'));
SELECT table_owner_is ('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'1 day'::interval, 'YYYYMMDD'), 'partman_owner',
    'Check that ownership change worked for time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'1 day'::interval, 'YYYYMMDD'));
SELECT table_owner_is ('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'2 days'::interval, 'YYYYMMDD'), 'partman_owner',
    'Check that ownership change worked for time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'2 days'::interval, 'YYYYMMDD'));
SELECT table_owner_is ('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'3 days'::interval, 'YYYYMMDD'), 'partman_owner',
    'Check that ownership change worked for time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'3 days'::interval, 'YYYYMMDD'));
SELECT table_owner_is ('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'4 days'::interval, 'YYYYMMDD'), 'partman_owner',
    'Check that ownership change worked for time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'4 days'::interval, 'YYYYMMDD'));

-- Test that maintenance will catch up
DO $$
BEGIN
    EXECUTE 'DROP TABLE partman_test.time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'2 days'::interval, 'YYYYMMDD');
    EXECUTE 'DROP TABLE partman_test.time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'1 days'::interval, 'YYYYMMDD');
    EXECUTE 'DROP TABLE partman_test.time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD');
    EXECUTE 'DROP TABLE partman_test.time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'1 days'::interval, 'YYYYMMDD');
    EXECUTE 'DROP TABLE partman_test.time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'2 days'::interval, 'YYYYMMDD');
    EXECUTE 'DROP TABLE partman_test.time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'3 days'::interval, 'YYYYMMDD');
    EXECUTE 'DROP TABLE partman_test.time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD');
    EXECUTE 'DROP TABLE partman_test.time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'5 days'::interval, 'YYYYMMDD');
    EXECUTE 'DROP TABLE partman_test.time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'6 days'::interval, 'YYYYMMDD');
    EXECUTE 'DROP TABLE partman_test.time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'7 days'::interval, 'YYYYMMDD');
    EXECUTE 'DROP TABLE partman_test.time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'8 days'::interval, 'YYYYMMDD');
    EXECUTE 'DROP TABLE partman_test.time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'9 days'::interval, 'YYYYMMDD');
    EXECUTE 'DROP TABLE partman_test.time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'10 days'::interval, 'YYYYMMDD');
    EXECUTE 'DROP TABLE partman_test.time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'11 days'::interval, 'YYYYMMDD');
    EXECUTE 'DROP TABLE partman_test.time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'12 days'::interval, 'YYYYMMDD');
END
$$;

SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'2 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'2 days'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'1 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'1 days'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'1 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'1 days'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'2 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'2 days'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'3 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'3 days'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'5 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'5 days'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'6 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'6 days'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'7 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'7 days'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'8 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'8 days'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'9 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'9 days'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'10 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'10 days'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'11 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'11 days'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'12 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'12 days'::interval, 'YYYYMMDD')||' does not exist');

SELECT run_maintenance();

SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'2 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'2 days'::interval, 'YYYYMMDD')||' does exist');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'1 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'1 days'::interval, 'YYYYMMDD')||' does exist');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD')||' does exist');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'1 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'1 days'::interval, 'YYYYMMDD')||' does exist');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'2 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'2 days'::interval, 'YYYYMMDD')||' does exist');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'3 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'3 days'::interval, 'YYYYMMDD')||' does exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD')||' does not exist');

INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(11,20), CURRENT_TIMESTAMP + '1 day'::interval);
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(21,25), CURRENT_TIMESTAMP + '2 days'::interval);
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(26,30), CURRENT_TIMESTAMP + '3 days'::interval);
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(1,10), CURRENT_TIMESTAMP);
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(40,49), CURRENT_TIMESTAMP - '1 day'::interval);
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(50,70), CURRENT_TIMESTAMP - '2 days'::interval);

SELECT run_maintenance();

SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD')||' does exist');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'5 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'5 days'::interval, 'YYYYMMDD')||' does exist');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'6 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'6 days'::interval, 'YYYYMMDD')||' does exist');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'7 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'7 days'::interval, 'YYYYMMDD')||' does exist');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'8 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'8 days'::interval, 'YYYYMMDD')||' does exist');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'9 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'9 days'::interval, 'YYYYMMDD')||' does exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'10 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'10 days'::interval, 'YYYYMMDD')||' does not exist');


INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(31,37), CURRENT_TIMESTAMP + '4 days'::interval);
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(101,122), CURRENT_TIMESTAMP + '5 days'::interval);
INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(123,150), CURRENT_TIMESTAMP + '6 days'::interval);

SELECT run_maintenance();

SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'10 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'10 days'::interval, 'YYYYMMDD')||' does exist');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'11 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'11 days'::interval, 'YYYYMMDD')||' does exist');
SELECT has_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'12 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'12 days'::interval, 'YYYYMMDD')||' does exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'13 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'13 days'::interval, 'YYYYMMDD')||' does not exist');

INSERT INTO partman_test.time_taptest_table (col1, col3) VALUES (generate_series(200,210), CURRENT_TIMESTAMP + '20 days'::interval);
SELECT results_eq('SELECT count(*)::int FROM ONLY partman_test.time_taptest_table_default', ARRAY[11], 'Check that data child scope goes to default');

SELECT drop_partition_time('partman_test.time_taptest_table', '3 days'::interval, p_keep_table := false);
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'4 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'4 days'::interval, 'YYYYMMDD')||' does not exist');

UPDATE part_config SET retention = '2 days'::interval WHERE parent_table = 'partman_test.time_taptest_table';
SELECT drop_partition_time('partman_test.time_taptest_table', p_retention_schema := 'partman_retention_test');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'3 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'3 days'::interval, 'YYYYMMDD')||' does not exist');
SELECT has_table('partman_retention_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'3 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'3 days'::interval, 'YYYYMMDD')||' got moved to new schema');

SELECT undo_partition('partman_test.time_taptest_table', 'partman_test.undo_taptest', 20, p_keep_table := false);
SELECT results_eq('SELECT count(*)::int FROM  partman_test.undo_taptest', ARRAY[129], 'Check count from target table after undo');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'1 day'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'1 day'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'2 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'2 days'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'3 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'3 days'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'4 days'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'5 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'5 days'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'6 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'6 days'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'7 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'7 days'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'8 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'8 days'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'9 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'9 days'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'10 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'10 days'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'11 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'11 days'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'12 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP+'12 days'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'1 day'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'1 day'::interval, 'YYYYMMDD')||' does not exist');
SELECT hasnt_table('partman_test', 'time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'2 days'::interval, 'YYYYMMDD'),
    'Check time_taptest_table_p'||to_char(CURRENT_TIMESTAMP-'2 days'::interval, 'YYYYMMDD')||' does not exist');

SELECT hasnt_table('partman', 'template_partman_test_time_taptest_table', 'Check that template table was dropped');

SELECT * FROM finish();
ROLLBACK;
