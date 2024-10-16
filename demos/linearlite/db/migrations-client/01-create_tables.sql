-- # Tables and indexes
CREATE TABLE IF NOT EXISTS "issue" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "modified" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "created" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "kanbanorder" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT FALSE, -- Soft delete for local deletions
    "new" BOOLEAN NOT NULL DEFAULT FALSE, -- New row flag for local inserts
    "modified_columns" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], -- Columns that have been modified locally
    "sent_to_server" BOOLEAN NOT NULL DEFAULT FALSE, -- Flag to track if the row has been sent to the server
    "synced" BOOLEAN GENERATED ALWAYS AS (ARRAY_LENGTH(modified_columns, 1) IS NULL AND NOT deleted AND NOT new) STORED,
    "backup" JSONB, -- JSONB column to store the backup of the row data for modified columns
    "search_vector" tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(description, '')), 'B')
    ) STORED,
    CONSTRAINT "issue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "comment" (
    "id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "issue_id" UUID NOT NULL,
    "modified" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "created" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "deleted" BOOLEAN NOT NULL DEFAULT FALSE, -- Soft delete for local deletions
    "new" BOOLEAN NOT NULL DEFAULT FALSE, -- New row flag for local inserts
    "modified_columns" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], -- Columns that have been modified locally
    "sent_to_server" BOOLEAN NOT NULL DEFAULT FALSE, -- Flag to track if the row has been sent to the server
    "synced" BOOLEAN GENERATED ALWAYS AS (ARRAY_LENGTH(modified_columns, 1) IS NULL AND NOT deleted AND NOT new) STORED,
    "backup" JSONB, -- JSONB column to store the backup of the row data for modified columns
    CONSTRAINT "comment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "issue_id_idx" ON "issue" ("id");
CREATE INDEX IF NOT EXISTS "issue_priority_idx" ON "issue" ("priority");
CREATE INDEX IF NOT EXISTS "issue_status_idx" ON "issue" ("status");
CREATE INDEX IF NOT EXISTS "issue_modified_idx" ON "issue" ("modified");
CREATE INDEX IF NOT EXISTS "issue_created_idx" ON "issue" ("created");
CREATE INDEX IF NOT EXISTS "issue_kanbanorder_idx" ON "issue" ("kanbanorder");
CREATE INDEX IF NOT EXISTS "issue_deleted_idx" ON "issue" ("deleted");
CREATE INDEX IF NOT EXISTS "issue_synced_idx" ON "issue" ("synced");
CREATE INDEX IF NOT EXISTS "issue_search_idx" ON "issue" USING GIN ("search_vector");

CREATE INDEX IF NOT EXISTS "comment_id_idx" ON "comment" ("id");
CREATE INDEX IF NOT EXISTS "comment_issue_id_idx" ON "comment" ("issue_id");
CREATE INDEX IF NOT EXISTS "comment_created_idx" ON "comment" ("created");
CREATE INDEX IF NOT EXISTS "comment_deleted_idx" ON "comment" ("deleted");
CREATE INDEX IF NOT EXISTS "comment_synced_idx" ON "comment" ("synced");

-- During sync the electric.syncing config var is set to true
-- We can use this in triggers to determine the action that should be performed

-- # Delete triggers:
-- - During sync we delete rows
-- - Otherwise we set the deleted flag to true
CREATE OR REPLACE FUNCTION handle_delete()
RETURNS TRIGGER AS $$
DECLARE
    is_syncing BOOLEAN;
    bypass_triggers BOOLEAN;
BEGIN
    -- Check if electric.syncing is true - defaults to false if not set
    SELECT COALESCE(NULLIF(current_setting('electric.syncing', true), ''), 'false')::boolean INTO is_syncing;
    -- Check if electric.bypass_triggers is true - defaults to false if not set
    SELECT COALESCE(NULLIF(current_setting('electric.bypass_triggers', true), ''), 'false')::boolean INTO bypass_triggers;

    IF bypass_triggers THEN
        RETURN OLD;
    END IF;

    IF is_syncing THEN
        -- If syncing we delete the row
        RETURN OLD;
    ELSE
        -- For local deletions, check if the row is new
        IF OLD.new THEN
            -- If the row is new, just delete it
            RETURN OLD;
        ELSE
            -- Otherwise, set the deleted flag instead of actually deleting
            EXECUTE format('UPDATE %I SET deleted = true WHERE id = $1', TG_TABLE_NAME) USING OLD.id;
            RETURN NULL;
        END IF;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER issue_delete_trigger
BEFORE DELETE ON issue
FOR EACH ROW
EXECUTE FUNCTION handle_delete();

CREATE OR REPLACE TRIGGER comment_delete_trigger
BEFORE DELETE ON comment
FOR EACH ROW
EXECUTE FUNCTION handle_delete();

-- # Insert triggers:
-- - During sync we insert rows and set modified_columns = []
-- - Otherwise we insert rows and set modified_columns to contain the names of all 
--   columns that are not local-state related

CREATE OR REPLACE FUNCTION handle_insert()
RETURNS TRIGGER AS $$
DECLARE
    is_syncing BOOLEAN;
    bypass_triggers BOOLEAN;
    modified_columns TEXT[] := ARRAY[]::TEXT[];
    col_name TEXT;
    new_value TEXT;
    old_value TEXT;
BEGIN
    -- Check if electric.syncing is true - defaults to false if not set
    SELECT COALESCE(NULLIF(current_setting('electric.syncing', true), ''), 'false')::boolean INTO is_syncing;
    -- Check if electric.bypass_triggers is true - defaults to false if not set
    SELECT COALESCE(NULLIF(current_setting('electric.bypass_triggers', true), ''), 'false')::boolean INTO bypass_triggers;

    IF bypass_triggers THEN
        RETURN NEW;
    END IF;

    IF is_syncing THEN
        -- If syncing, we set modified_columns to an empty array
        NEW.modified_columns := ARRAY[]::TEXT[];
        NEW.new := FALSE;
        NEW.sent_to_server := FALSE;
        -- If the row already exists in the database, handle it as an update
        EXECUTE format('SELECT 1 FROM %I WHERE id = $1', TG_TABLE_NAME) USING NEW.id INTO old_value;
        IF old_value IS NOT NULL THEN
            -- Apply update logic similar to handle_update function
            FOR col_name IN SELECT column_name 
                               FROM information_schema.columns 
                               WHERE table_name = TG_TABLE_NAME AND
                                     column_name NOT IN ('id', 'synced', 'modified_columns', 'backup', 'deleted', 'new', 'sent_to_server') LOOP
                EXECUTE format('SELECT $1.%I', col_name) USING NEW INTO new_value;
                EXECUTE format('SELECT %I FROM %I WHERE id = $1', col_name, TG_TABLE_NAME) USING NEW.id INTO old_value;
                IF new_value IS DISTINCT FROM old_value THEN
                    EXECUTE format('UPDATE %I SET %I = $1 WHERE id = $2', TG_TABLE_NAME, col_name) USING new_value, NEW.id;
                END IF;
            END LOOP;
            -- Update modified_columns
            EXECUTE format('UPDATE %I SET modified_columns = $1 WHERE id = $2', TG_TABLE_NAME)
            USING ARRAY[]::TEXT[], NEW.id;
            -- Update new flag
            EXECUTE format('UPDATE %I SET new = $1 WHERE id = $2', TG_TABLE_NAME)
            USING FALSE, NEW.id;
            -- Update sent_to_server flag
            EXECUTE format('UPDATE %I SET sent_to_server = $1 WHERE id = $2', TG_TABLE_NAME)
            USING FALSE, NEW.id;
            RETURN NULL; -- Prevent insertion of a new row
        END IF;
    ELSE
        -- For local inserts, we add all non-local-state columns to modified_columns
        SELECT array_agg(column_name) INTO modified_columns
        FROM information_schema.columns 
        WHERE table_name = TG_TABLE_NAME
        AND column_name NOT IN ('id', 'synced', 'modified_columns', 'backup', 'deleted', 'new', 'sent_to_server');
        NEW.modified_columns := modified_columns;
        NEW.new := TRUE;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER issue_insert_trigger
BEFORE INSERT ON issue
FOR EACH ROW
EXECUTE FUNCTION handle_insert();

CREATE OR REPLACE TRIGGER comment_insert_trigger
BEFORE INSERT ON comment
FOR EACH ROW
EXECUTE FUNCTION handle_insert();

-- # Update triggers:
-- - During sync:
--   - If the new modified timestamp is >= the one in the database, we apply the update,
--     set modified_columns = [], and set backup = NULL
--   - Otherwise we apply the update to columns that are NOT in modified_columns and
--   - and save the values for the non-updated columns in the backup JSONB column
-- - During a non-sync transaction:
--   - If we write over a column (that are not local-state related) that was not 
--     already modified, we add that column name to modified_columns, and copy the 
--     current value from the column to the backup JSONB column
--   - Otherwise we just update the column

CREATE OR REPLACE FUNCTION handle_update()
RETURNS TRIGGER AS $$
DECLARE
    is_syncing BOOLEAN;
    bypass_triggers BOOLEAN;
    column_name TEXT;
    old_value TEXT;
    new_value TEXT;
BEGIN
    -- Check if electric.syncing is true - defaults to false if not set
    SELECT COALESCE(NULLIF(current_setting('electric.syncing', true), ''), 'false')::boolean INTO is_syncing;
    -- Check if electric.bypass_triggers is true - defaults to false if not set
    SELECT COALESCE(NULLIF(current_setting('electric.bypass_triggers', true), ''), 'false')::boolean INTO bypass_triggers;

    IF bypass_triggers THEN
        RETURN NEW;
    END IF;

    IF is_syncing THEN
        -- During sync
        IF (OLD.synced = TRUE) OR (OLD.sent_to_server = TRUE AND NEW.modified >= OLD.modified) THEN
            -- Apply the update, reset modified_columns, backup, new, and sent_to_server flags
            NEW.modified_columns := ARRAY[]::TEXT[];
            NEW.backup := NULL;
            NEW.new := FALSE;
            NEW.sent_to_server := FALSE;
        ELSE
            -- Apply update only to columns not in modified_columns
            FOR column_name IN SELECT columns.column_name 
                               FROM information_schema.columns 
                               WHERE columns.table_name = TG_TABLE_NAME 
                               AND columns.column_name NOT IN ('id', 'synced', 'modified_columns', 'backup', 'deleted', 'new', 'sent_to_server') LOOP
                IF column_name != ANY(OLD.modified_columns) THEN
                    EXECUTE format('SELECT ($1).%I', column_name) USING NEW INTO new_value;
                    EXECUTE format('SELECT ($1).%I', column_name) USING OLD INTO old_value;
                    IF new_value IS DISTINCT FROM old_value THEN
                        EXECUTE format('UPDATE %I SET %I = $1 WHERE id = $2', TG_TABLE_NAME, column_name) USING new_value, NEW.id;
                        NEW.backup := jsonb_set(COALESCE(NEW.backup, '{}'::jsonb), ARRAY[column_name], to_jsonb(old_value));
                    END IF;
                END IF;
            END LOOP;
            NEW.new := FALSE;
        END IF;
    ELSE
        -- During non-sync transaction
        FOR column_name IN SELECT columns.column_name 
                           FROM information_schema.columns 
                           WHERE columns.table_name = TG_TABLE_NAME 
                           AND columns.column_name NOT IN ('id', 'synced', 'modified_columns', 'backup', 'deleted', 'new', 'sent_to_server') LOOP
            EXECUTE format('SELECT ($1).%I', column_name) USING NEW INTO new_value;
            EXECUTE format('SELECT ($1).%I', column_name) USING OLD INTO old_value;
            IF new_value IS DISTINCT FROM old_value THEN
                IF NOT (column_name = ANY(OLD.modified_columns)) THEN
                    NEW.modified_columns := array_append(NEW.modified_columns, column_name);
                    NEW.backup := jsonb_set(COALESCE(NEW.backup, '{}'::jsonb), ARRAY[column_name], to_jsonb(old_value));
                END IF;
            END IF;
        END LOOP;
        NEW.sent_to_server := FALSE;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER issue_update_trigger
BEFORE UPDATE ON issue
FOR EACH ROW
EXECUTE FUNCTION handle_update();

CREATE OR REPLACE TRIGGER comment_update_trigger
BEFORE UPDATE ON comment
FOR EACH ROW
EXECUTE FUNCTION handle_update();

-- # Functions to revert local changes using the backup column

CREATE OR REPLACE FUNCTION revert_local_changes(table_name TEXT, row_id UUID)
RETURNS VOID AS $$
DECLARE
    backup_data JSONB;
    column_name TEXT;
    column_value JSONB;
BEGIN
    EXECUTE format('SELECT backup FROM %I WHERE id = $1', table_name)
    INTO backup_data
    USING row_id;

    IF backup_data IS NOT NULL THEN
        FOR column_name, column_value IN SELECT * FROM jsonb_each(backup_data)
        LOOP
            EXECUTE format('UPDATE %I SET %I = $1, modified_columns = array_remove(modified_columns, $2) WHERE id = $3', table_name, column_name)
            USING column_value, column_name, row_id;
        END LOOP;

        -- Clear the backup after reverting
        EXECUTE format('UPDATE %I SET backup = NULL WHERE id = $1', table_name)
        USING row_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Example usage:
-- SELECT revert_local_changes('issue', '123e4567-e89b-12d3-a456-426614174000');
-- SELECT revert_local_changes('comment', '123e4567-e89b-12d3-a456-426614174001');
