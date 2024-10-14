-- # Main tables
CREATE TABLE IF NOT EXISTS "issue" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "modified" TIMESTAMPTZ NOT NULL,
    "created" TIMESTAMPTZ NOT NULL,
    "kanbanorder" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "version" BIGINT NOT NULL DEFAULT 0,
    "synced" BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT "issue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "comment" (
    "id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "issue_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,
    "version" BIGINT NOT NULL DEFAULT 0,
    "synced" BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT "comment_pkey" PRIMARY KEY ("id")
);

-- # Indexes for the synced tables
CREATE INDEX IF NOT EXISTS "issue_id_idx" ON "issue" ("id");
CREATE INDEX IF NOT EXISTS "issue_priority_idx" ON "issue" ("priority");
CREATE INDEX IF NOT EXISTS "issue_status_idx" ON "issue" ("status");
CREATE INDEX IF NOT EXISTS "issue_modified_idx" ON "issue" ("modified");
CREATE INDEX IF NOT EXISTS "issue_created_idx" ON "issue" ("created");
CREATE INDEX IF NOT EXISTS "issue_kanbanorder_idx" ON "issue" ("kanbanorder");

CREATE INDEX IF NOT EXISTS "comment_id_idx" ON "comment" ("id");
CREATE INDEX IF NOT EXISTS "comment_issue_id_idx" ON "comment" ("issue_id");
CREATE INDEX IF NOT EXISTS "comment_created_at_idx" ON "comment" ("created_at");

-- # Backup tables
CREATE TABLE IF NOT EXISTS "issue_backup" LIKE "issue";
ALTER TABLE "issue_backup" ADD CONSTRAINT "issue_backup_pkey" PRIMARY KEY ("id");

CREATE TABLE IF NOT EXISTS "comment_backup" LIKE "comment";
ALTER TABLE "comment_backup" ADD CONSTRAINT "comment_backup_pkey" PRIMARY KEY ("id");

-- # Tables to track local deletions
CREATE TABLE IF NOT EXISTS "issue_deleted" (
    "id" UUID NOT NULL,
    CONSTRAINT "issue_deleted_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "comment_deleted" (
    "id" UUID NOT NULL,
    CONSTRAINT "comment_deleted_pkey" PRIMARY KEY ("id")
);

-- # Triggers during insert to set synced to true if syncing
CREATE OR REPLACE FUNCTION set_synced_on_insert()
RETURNS TRIGGER AS $$
DECLARE
    is_syncing BOOLEAN;
BEGIN
    -- Check if electric.syncing is true - defaults to false if not set
    SELECT COALESCE(current_setting('electric.syncing', true), 'false')::boolean INTO is_syncing;

    IF is_syncing THEN
        NEW.synced = true;
    ELSE
        NEW.synced = false;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_synced_issue_insert
BEFORE INSERT ON issue
FOR EACH ROW
EXECUTE FUNCTION set_synced_on_insert();

CREATE TRIGGER set_synced_comment_insert
BEFORE INSERT ON comment
FOR EACH ROW
EXECUTE FUNCTION set_synced_on_insert();


-- # Triggers to handle conflicts during sync
CREATE OR REPLACE FUNCTION handle_issue_update()
RETURNS TRIGGER AS $$
DECLARE
    is_syncing BOOLEAN;
BEGIN
    -- Check if electric.syncing is true - defaults to false if not set
    SELECT COALESCE(current_setting('electric.syncing', true), 'false')::boolean INTO is_syncing;

    IF is_syncing THEN
        -- If syncing is true
        IF OLD.synced = true THEN
            -- If the current row is synced, update normally
            RETURN NEW;
        ELSIF NEW.version >= OLD.version THEN
            -- If the new version is >= current version, update and delete from backup
            DELETE FROM issue_backup WHERE id = NEW.id;
            -- Set synced to true
            NEW.synced = true;
            RETURN NEW;
        ELSE
            -- Otherwise, update the backup table
            UPDATE issue_backup SET
                title = NEW.title,
                description = NEW.description,
                priority = NEW.priority,
                status = NEW.status,
                modified = NEW.modified,
                created = NEW.created,
                kanbanorder = NEW.kanbanorder,
                username = NEW.username,
                version = NEW.version,
                synced = NEW.synced
            WHERE id = NEW.id;
            RETURN OLD;
        END IF;
    ELSE
        -- If syncing is not true
        IF OLD.synced = true THEN
            -- If the current row is synced, copy to backup then update
            INSERT INTO issue_backup
            SELECT * FROM issue WHERE id = NEW.id;
        END IF;
        -- Update the row normally
        NEW.synced = false;
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER issue_update_trigger
BEFORE UPDATE ON issue
FOR EACH ROW
EXECUTE FUNCTION handle_issue_update();

CREATE OR REPLACE FUNCTION handle_comment_update()
RETURNS TRIGGER AS $$
DECLARE
    is_syncing BOOLEAN;
BEGIN
    -- Check if electric.syncing is true - defaults to false if not set
    SELECT COALESCE(current_setting('electric.syncing', true), 'false')::boolean INTO is_syncing;

    IF is_syncing THEN
        -- If syncing is true
        IF OLD.synced = true THEN
            -- If the current row is synced, update normally
            RETURN NEW;
        ELSIF NEW.version >= OLD.version THEN
            -- If the new version is >= current version, update and delete from backup
            DELETE FROM comment_backup WHERE id = NEW.id;
            RETURN NEW;
        ELSE
            -- Otherwise, update the backup table
            UPDATE comment_backup SET
                issue_id = NEW.issue_id,
                body = NEW.body,
                modified = NEW.modified,
                created = NEW.created,
                username = NEW.username,
                version = NEW.version,
                synced = NEW.synced
            WHERE id = NEW.id;
            RETURN OLD;
        END IF;
    ELSE
        -- If syncing is not true
        IF OLD.synced = true THEN
            -- If the current row is synced, copy to backup then update
            INSERT INTO comment_backup
            SELECT * FROM comment WHERE id = NEW.id;
        END IF;
        -- Update the row normally
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER comment_update_trigger
BEFORE UPDATE ON comment
FOR EACH ROW
EXECUTE FUNCTION handle_comment_update();

-- # Triggers to handle local deletions
CREATE OR REPLACE FUNCTION handle_issue_delete()
RETURNS TRIGGER AS $$
BEGIN
    -- If the row is synced, make a backup
    IF OLD.synced = true THEN
        INSERT INTO issue_backup VALUES (OLD.*);
    -- If the row is not synced but has a backup, update the backup
    ELSIF EXISTS (SELECT 1 FROM issue_backup WHERE id = OLD.id) THEN
        UPDATE issue_backup
        SET title = OLD.title,
            priority = OLD.priority,
            status = OLD.status,
            modified = OLD.modified,
            created = OLD.created,
            kanbanorder = OLD.kanbanorder,
            username = OLD.username,
            version = OLD.version,
            synced = OLD.synced
        WHERE id = OLD.id;
    END IF;

    -- Insert the id into the deleted_issues table
    INSERT INTO deleted_issues (id) VALUES (OLD.id);

    -- The row will be deleted automatically after the trigger
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER issue_delete_trigger
BEFORE DELETE ON issue
FOR EACH ROW
EXECUTE FUNCTION handle_issue_delete();

CREATE OR REPLACE FUNCTION handle_comment_delete()
RETURNS TRIGGER AS $$
BEGIN
    -- If the row is synced, make a backup
    IF OLD.synced = true THEN
        INSERT INTO comment_backup VALUES (OLD.*);
    -- If the row is not synced but has a backup, update the backup
    ELSIF EXISTS (SELECT 1 FROM comment_backup WHERE id = OLD.id) THEN
        UPDATE comment_backup
        SET issue_id = OLD.issue_id,
            body = OLD.body,
            modified = OLD.modified,
            created = OLD.created,
            username = OLD.username,
            version = OLD.version,
            synced = OLD.synced
        WHERE id = OLD.id;
    END IF;

    -- Insert the id into the deleted_comments table
    INSERT INTO deleted_comments (id) VALUES (OLD.id);

    -- The row will be deleted automatically after the trigger
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER comment_delete_trigger
BEFORE DELETE ON comment
FOR EACH ROW
EXECUTE FUNCTION handle_comment_delete();

-- # Revert functions to rollback to a backup if a row is not synced
CREATE OR REPLACE FUNCTION revert_issue_to_backup(issue_id UUID)
RETURNS VOID AS $$
BEGIN
    -- Check if the issue exists and is unsynced
    IF EXISTS (SELECT 1 FROM issue WHERE id = issue_id AND synced = false) THEN
        -- Check if a backup exists
        IF EXISTS (SELECT 1 FROM issue_backup WHERE id = issue_id) THEN
            -- Delete the current unsynced row
            DELETE FROM issue WHERE id = issue_id;
            
            -- Insert the backup row
            INSERT INTO issue
            SELECT * FROM issue_backup WHERE id = issue_id;
            
            -- Remove the backup
            DELETE FROM issue_backup WHERE id = issue_id;
        END IF;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION revert_comment_to_backup(comment_id UUID)
RETURNS VOID AS $$
BEGIN
    -- Check if the comment exists and is unsynced
    IF EXISTS (SELECT 1 FROM comment WHERE id = comment_id AND synced = false) THEN
        -- Check if a backup exists
        IF EXISTS (SELECT 1 FROM comment_backup WHERE id = comment_id) THEN
            -- Delete the current unsynced row
            DELETE FROM comment WHERE id = comment_id;
            
            -- Insert the backup row
            INSERT INTO comment
            SELECT * FROM comment_backup WHERE id = comment_id;
            
            -- Remove the backup
            DELETE FROM comment_backup WHERE id = comment_id;
        END IF;
    END IF;
END;
$$ LANGUAGE plpgsql;
