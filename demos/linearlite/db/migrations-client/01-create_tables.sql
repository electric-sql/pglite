-- # Tables for the synced shapes
-- These are never modified by the user, they are maintained by the sync plugin to
-- be a pure copy of the server's state

CREATE TABLE IF NOT EXISTS "issue_synced" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "modified" TIMESTAMPTZ NOT NULL,
    "created" TIMESTAMPTZ NOT NULL,
    "kanbanorder" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "version" BIGINT NOT NULL,
    CONSTRAINT "issue_synced_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "comment_synced" (
    "id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "issue_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,
    "version" BIGINT NOT NULL,
    CONSTRAINT "comment_synced_pkey" PRIMARY KEY ("id") --,
    -- FOREIGN KEY (issue_id) REFERENCES issue_synced(id) ON DELETE CASCADE
    -- There is currently no transactional integrity between shapes during sync, and as 
    -- shapes are currently single table we can't enforce FK constraints across shapes.
    -- If a issue is deleted, we rely on the cascade applied on the server to delete
    -- the comments when the delete is synced.
);

-- # Indexes for the synced tables
CREATE INDEX IF NOT EXISTS "issue_synced_id_idx" ON "issue_synced" ("id");
CREATE INDEX IF NOT EXISTS "issue_synced_created_idx" ON "issue_synced" ("created");
CREATE INDEX IF NOT EXISTS "issue_synced_modified_idx" ON "issue_synced" ("modified");
CREATE INDEX IF NOT EXISTS "issue_synced_status_idx" ON "issue_synced" ("status");
CREATE INDEX IF NOT EXISTS "issue_synced_priority_idx" ON "issue_synced" ("priority");

CREATE INDEX IF NOT EXISTS "comment_synced_id_idx" ON "comment_synced" ("id");
CREATE INDEX IF NOT EXISTS "comment_synced_created_at_idx" ON "comment_synced" ("created_at");
CREATE INDEX IF NOT EXISTS "comment_synced_issue_id_idx" ON "comment_synced" ("issue_id");

-- # Tables for the local changes
-- All changes are applied to these local only tables, and synced back to the server.
-- These tables mirror the server tables, but have nullable columns, along with a 
-- changed_columns column to track which columns have changed. THe "state" of a row is 
-- determined by combining the local and synced tables, where a "changed_column" from
-- the local table overrides the value in the synced table.
-- "is_deleted" is set to true for rows that are deleted locally.
-- "synced_at" is set to the offset prefix at which the row was synced. We then watch
-- for the prefix to be reached in the sync stream, and then delete the local row.
-- If a change is made to a row that has been synced, but not yet deleted, the
-- "synced_at" value is cleared, and the change is then synced to the server again.

CREATE TABLE IF NOT EXISTS "issue_local" (
    "id" UUID NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "priority" TEXT,
    "status" TEXT,
    "modified" TIMESTAMPTZ,
    "created" TIMESTAMPTZ,
    "kanbanorder" TEXT,
    "username" TEXT,
    -- A text array of the column names that have changed.
    "changed_columns" TEXT[],
    -- A columns to track is a row is new or an update.
    "is_new" BOOLEAN DEFAULT FALSE,
    -- If a row is deleted, this is set to true.
    "is_deleted" BOOLEAN DEFAULT FALSE,
    -- A column to track the offset prefix at which the row was synced.
    "synced_at" BIGINT,
    CONSTRAINT "issue_local_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "comment_local" (
    "id" UUID NOT NULL,
    "body" TEXT,
    "username" TEXT,    
    "issue_id" UUID,
    "created_at" TIMESTAMPTZ,
    -- A text array of the column names that have changed.
    "changed_columns" TEXT[],
    -- A columns to track is a row is new or an update.
    "is_new" BOOLEAN DEFAULT FALSE,
    -- If a row is deleted, this is set to true.
    "is_deleted" BOOLEAN DEFAULT FALSE,
    -- A column to track the offset prefix at which the row was synced.
    "synced_at" BIGINT,
    CONSTRAINT "comment_local_pkey" PRIMARY KEY ("id")
);


-- # Indexes for the local tables
CREATE INDEX IF NOT EXISTS "issue_local_id_idx" ON "issue_local" ("id");
CREATE INDEX IF NOT EXISTS "issue_local_synced_at_idx" ON "issue_local" ("synced_at");
CREATE INDEX IF NOT EXISTS "issue_local_created_idx" ON "issue_local" ("created");
CREATE INDEX IF NOT EXISTS "issue_local_modified_idx" ON "issue_local" ("modified");
CREATE INDEX IF NOT EXISTS "issue_local_status_idx" ON "issue_local" ("status");
CREATE INDEX IF NOT EXISTS "issue_local_priority_idx" ON "issue_local" ("priority");
CREATE INDEX IF NOT EXISTS "issue_local_is_deleted_idx" ON "issue_local" ("is_deleted");
CREATE INDEX IF NOT EXISTS "issue_local_is_new_idx" ON "issue_local" ("is_new");

CREATE INDEX IF NOT EXISTS "comment_local_id_idx" ON "comment_local" ("id");
CREATE INDEX IF NOT EXISTS "comment_local_created_at_idx" ON "comment_local" ("created_at");
CREATE INDEX IF NOT EXISTS "comment_local_issue_id_idx" ON "comment_local" ("issue_id");
CREATE INDEX IF NOT EXISTS "comment_local_is_deleted_idx" ON "comment_local" ("is_deleted");
CREATE INDEX IF NOT EXISTS "comment_local_is_new_idx" ON "comment_local" ("is_new");


-- # Views of the unified sync tables and local changes
-- They take the synced table and overlay the local changes on top of it.
-- Rows ids that have a match in the local table are "changed", and the vales from that
-- local row, specified by the "changed_columns" are used in preference to the values
-- in the synced table.
-- Rows ids that are in the local table but not in the synced table are "added".
-- Rows ids that are marked as deleted in the local table are excluded.

CREATE OR REPLACE VIEW "issue" AS
    SELECT 
        COALESCE(l."id", s."id") AS "id",
        CASE WHEN 'title' = ANY(l."changed_columns") THEN l."title" ELSE s."title" END AS "title",
        CASE WHEN 'description' = ANY(l."changed_columns") THEN l."description" ELSE s."description" END AS "description",
        CASE WHEN 'priority' = ANY(l."changed_columns") THEN l."priority" ELSE s."priority" END AS "priority",
        CASE WHEN 'status' = ANY(l."changed_columns") THEN l."status" ELSE s."status" END AS "status",
        CASE WHEN 'modified' = ANY(l."changed_columns") THEN l."modified" ELSE s."modified" END AS "modified",
        CASE WHEN 'created' = ANY(l."changed_columns") THEN l."created" ELSE s."created" END AS "created",
        CASE WHEN 'kanbanorder' = ANY(l."changed_columns") THEN l."kanbanorder" ELSE s."kanbanorder" END AS "kanbanorder",
        CASE WHEN 'username' = ANY(l."changed_columns") THEN l."username" ELSE s."username" END AS "username",
        CASE WHEN l."id" IS NOT NULL THEN FALSE ELSE TRUE END AS "synced"
    FROM "issue_synced" s
    FULL OUTER JOIN "issue_local" l ON s."id" = l."id"
    WHERE l."id" IS NULL OR l."is_deleted" = FALSE;

CREATE OR REPLACE VIEW "comment" AS
    SELECT 
        COALESCE(l."id", s."id") AS "id",
        CASE WHEN 'body' = ANY(l."changed_columns") THEN l."body" ELSE s."body" END AS "body",
        CASE WHEN 'username' = ANY(l."changed_columns") THEN l."username" ELSE s."username" END AS "username",
        CASE WHEN 'issue_id' = ANY(l."changed_columns") THEN l."issue_id" ELSE s."issue_id" END AS "issue_id",
        CASE WHEN 'created_at' = ANY(l."changed_columns") THEN l."created_at" ELSE s."created_at" END AS "created_at",
        CASE WHEN l."id" IS NOT NULL THEN FALSE ELSE TRUE END AS "synced"
    FROM "comment_synced" s
    FULL OUTER JOIN "comment_local" l ON s."id" = l."id"
    WHERE l."id" IS NULL OR l."is_deleted" = FALSE;

-- Add INSTEAD OF INSERT, UPDATE and DELETE triggers to the items view to redirect
-- the operations to the appropriate table.

-- The insert trigger performs these actions
-- 1. Checks that the id is unique, i.e. not present in the synced table or local table.
-- 2. Inserts the row into the local table.
-- 3. Sets the "synced_at" to NULL, to indicate that the row has not been synced.
-- 4. Sets the "changed_columns" to list all the columns as they are all new.
CREATE OR REPLACE FUNCTION issue_insert_trigger()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if the id is present in the synced table
    IF EXISTS (SELECT 1 FROM "issue_synced" WHERE "id" = NEW."id") THEN
        RAISE EXCEPTION 'Cannot insert: id already exists in issue_synced table';
    END IF;

    -- Check if the id is present in the local table
    IF EXISTS (SELECT 1 FROM "issue_local" WHERE "id" = NEW."id") THEN
        RAISE EXCEPTION 'Cannot insert: id already exists in issue_local table';
    END IF;

    -- Insert the row into the local table
    INSERT INTO "issue_local" (
        "id",
        "title",
        "description",
        "priority",
        "status",
        "modified",
        "created",
        "kanbanorder",
        "username",
        "changed_columns",
        "is_new",
        "synced_at"
    )
    VALUES (
        NEW."id",
        NEW."title",
        NEW."description",
        NEW."priority",
        NEW."status",
        NEW."modified",
        NEW."created",
        NEW."kanbanorder",
        NEW."username",
        ARRAY['title', 'description', 'priority', 'status', 'modified', 'created', 'kanbanorder', 'username'],
        TRUE,
        NULL
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER issue_insert
INSTEAD OF INSERT ON "issue"
FOR EACH ROW
EXECUTE FUNCTION issue_insert_trigger();

-- The update trigger performs these actions
-- 1. Does an "upsert" to the local table, setting the changed columns. i.e. if the
--    row is not present in the local table, it is inserted. If the row is present,
--    it is updated. Only the columns that have changed are updated.
-- 2. Sets the "changed_columns" to list all the columns that have changed compared to the synced table.
-- 3. Sets the "synced_at" to NULL, to indicate that the row has not been synced.
-- 4. When updating a previous local change, it combines both the old change and new change.
CREATE OR REPLACE FUNCTION issue_update_trigger()
RETURNS TRIGGER AS $$
DECLARE
    synced_row "issue_synced"%ROWTYPE;
    local_row "issue_local"%ROWTYPE;
    changed_cols TEXT[] := '{}';
BEGIN
    -- Fetch the corresponding rows from the synced and local tables
    SELECT * INTO synced_row FROM "issue_synced" WHERE "id" = NEW."id";
    SELECT * INTO local_row FROM "issue_local" WHERE "id" = NEW."id";

    -- If the row is not present in the local table, insert it
    IF NOT FOUND THEN
        -- Compare each column with the synced table and add to changed_cols if different
        IF NEW."title" IS DISTINCT FROM synced_row."title" THEN
            changed_cols := array_append(changed_cols, 'title');
        END IF;
        IF NEW."description" IS DISTINCT FROM synced_row."description" THEN
            changed_cols := array_append(changed_cols, 'description');
        END IF;
        IF NEW."priority" IS DISTINCT FROM synced_row."priority" THEN
            changed_cols := array_append(changed_cols, 'priority');
        END IF;
        IF NEW."status" IS DISTINCT FROM synced_row."status" THEN
            changed_cols := array_append(changed_cols, 'status');
        END IF;
        IF NEW."modified" IS DISTINCT FROM synced_row."modified" THEN
            changed_cols := array_append(changed_cols, 'modified');
        END IF;
        IF NEW."created" IS DISTINCT FROM synced_row."created" THEN
            changed_cols := array_append(changed_cols, 'created');
        END IF;
        IF NEW."kanbanorder" IS DISTINCT FROM synced_row."kanbanorder" THEN
            changed_cols := array_append(changed_cols, 'kanbanorder');
        END IF;
        IF NEW."username" IS DISTINCT FROM synced_row."username" THEN
            changed_cols := array_append(changed_cols, 'username');
        END IF;

        INSERT INTO "issue_local" (
            "id",
            "title",
            "description",
            "priority",
            "status",
            "modified",
            "created",
            "kanbanorder",
            "username",
            "changed_columns",
            "synced_at"
        )
        VALUES (
            NEW."id",
            NEW."title",
            NEW."description",
            NEW."priority",
            NEW."status",
            NEW."modified",
            NEW."created",
            NEW."kanbanorder",
            NEW."username",
            changed_cols,
            NULL
        );
    ELSE
        -- Update the local table and adjust changed_columns
        UPDATE "issue_local"
        SET
            "title" = CASE WHEN NEW."title" IS DISTINCT FROM synced_row."title" THEN NEW."title" ELSE local_row."title" END,
            "description" = CASE WHEN NEW."description" IS DISTINCT FROM synced_row."description" THEN NEW."description" ELSE local_row."description" END,
            "priority" = CASE WHEN NEW."priority" IS DISTINCT FROM synced_row."priority" THEN NEW."priority" ELSE local_row."priority" END,
            "status" = CASE WHEN NEW."status" IS DISTINCT FROM synced_row."status" THEN NEW."status" ELSE local_row."status" END,
            "modified" = CASE WHEN NEW."modified" IS DISTINCT FROM synced_row."modified" THEN NEW."modified" ELSE local_row."modified" END,
            "created" = CASE WHEN NEW."created" IS DISTINCT FROM synced_row."created" THEN NEW."created" ELSE local_row."created" END,
            "kanbanorder" = CASE WHEN NEW."kanbanorder" IS DISTINCT FROM synced_row."kanbanorder" THEN NEW."kanbanorder" ELSE local_row."kanbanorder" END,
            "username" = CASE WHEN NEW."username" IS DISTINCT FROM synced_row."username" THEN NEW."username" ELSE local_row."username" END,
            "changed_columns" = (
                SELECT array_agg(DISTINCT col)
                FROM (
                    SELECT unnest(local_row."changed_columns") AS col
                    UNION
                    SELECT unnest(ARRAY['title', 'description', 'priority', 'status', 'modified', 'created', 'kanbanorder', 'username']) AS col
                ) AS cols
                WHERE (CASE 
                    WHEN col = 'title' THEN COALESCE(NEW."title", local_row."title") IS DISTINCT FROM synced_row."title"
                    WHEN col = 'description' THEN COALESCE(NEW."description", local_row."description") IS DISTINCT FROM synced_row."description"
                    WHEN col = 'priority' THEN COALESCE(NEW."priority", local_row."priority") IS DISTINCT FROM synced_row."priority"
                    WHEN col = 'status' THEN COALESCE(NEW."status", local_row."status") IS DISTINCT FROM synced_row."status"
                    WHEN col = 'modified' THEN COALESCE(NEW."modified", local_row."modified") IS DISTINCT FROM synced_row."modified"
                    WHEN col = 'created' THEN COALESCE(NEW."created", local_row."created") IS DISTINCT FROM synced_row."created"
                    WHEN col = 'kanbanorder' THEN COALESCE(NEW."kanbanorder", local_row."kanbanorder") IS DISTINCT FROM synced_row."kanbanorder"
                    WHEN col = 'username' THEN COALESCE(NEW."username", local_row."username") IS DISTINCT FROM synced_row."username"
                END)
            ),
            "synced_at" = NULL
        WHERE "id" = NEW."id";
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER issue_update
INSTEAD OF UPDATE ON "issue"
FOR EACH ROW
EXECUTE FUNCTION issue_update_trigger();

-- The delete trigger performs these actions
-- 1. Sets the "is_deleted" flag to true for the row in the local table.
--    If the row is not present in the local table, it is inserted.
-- 2. Sets the "synced_at" to NULL, to indicate that the row has not been synced.
CREATE OR REPLACE FUNCTION issue_delete_trigger()
RETURNS TRIGGER AS $$
BEGIN
    -- Is the row present in the local table?
    IF EXISTS (SELECT 1 FROM "issue_local" WHERE "id" = OLD."id") THEN
        -- Set the "is_deleted" flag to true for the row in the local table
        UPDATE "issue_local"
        SET 
            "is_deleted" = TRUE,
            "synced_at" = NULL
        WHERE "id" = OLD."id";
    ELSE
        -- The row is not present in the local table, insert it
        INSERT INTO "issue_local" (
            "id",
            "is_deleted",
            "synced_at"
        )
        VALUES (
            OLD."id",
            TRUE,
            NULL
        );
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER issue_delete
INSTEAD OF DELETE ON "issue"
FOR EACH ROW
EXECUTE FUNCTION issue_delete_trigger();

-- Add INSTEAD OF INSERT, UPDATE and DELETE triggers to the comments view to redirect
-- the operations to the appropriate table.

-- The insert trigger for comments
CREATE OR REPLACE FUNCTION comment_insert_trigger()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if the id is present in the synced table
    IF EXISTS (SELECT 1 FROM "comment_synced" WHERE "id" = NEW."id") THEN
        RAISE EXCEPTION 'Cannot insert: id already exists in comment_synced table';
    END IF;

    -- Check if the id is present in the local table
    IF EXISTS (SELECT 1 FROM "comment_local" WHERE "id" = NEW."id") THEN
        RAISE EXCEPTION 'Cannot insert: id already exists in comment_local table';
    END IF;

    -- Insert the row into the local table
    INSERT INTO "comment_local" (
        "id",
        "body",
        "username",
        "issue_id",
        "created_at",
        "changed_columns",
        "is_new",
        "synced_at"
    )
    VALUES (
        NEW."id",
        NEW."body",
        NEW."username",
        NEW."issue_id",
        NEW."created_at",
        ARRAY['body', 'username', 'issue_id', 'created_at'],
        TRUE,
        NULL
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER comment_insert
INSTEAD OF INSERT ON "comment"
FOR EACH ROW
EXECUTE FUNCTION comment_insert_trigger();

-- The update trigger for comments
CREATE OR REPLACE FUNCTION comment_update_trigger()
RETURNS TRIGGER AS $$
BEGIN
    -- Is the row present in the local table?
    IF EXISTS (SELECT 1 FROM "comment_local" WHERE "id" = NEW."id") THEN
        -- Update the existing row in the local table
        UPDATE "comment_local"
        SET 
            "body" = CASE WHEN NEW."body" <> OLD."body" THEN NEW."body" ELSE "body" END,
            "username" = CASE WHEN NEW."username" <> OLD."username" THEN NEW."username" ELSE "username" END,
            "issue_id" = CASE WHEN NEW."issue_id" <> OLD."issue_id" THEN NEW."issue_id" ELSE "issue_id" END,
            "created_at" = CASE WHEN NEW."created_at" <> OLD."created_at" THEN NEW."created_at" ELSE "created_at" END,
            "changed_columns" = ARRAY_APPEND(
                ARRAY_REMOVE(
                    "changed_columns",
                    CASE WHEN NEW."body" <> OLD."body" THEN 'body' ELSE NULL END,
                    CASE WHEN NEW."username" <> OLD."username" THEN 'username' ELSE NULL END,
                    CASE WHEN NEW."issue_id" <> OLD."issue_id" THEN 'issue_id' ELSE NULL END,
                    CASE WHEN NEW."created_at" <> OLD."created_at" THEN 'created_at' ELSE NULL END
                ),
                CASE WHEN NEW."body" <> OLD."body" THEN 'body'
                     WHEN NEW."username" <> OLD."username" THEN 'username'
                     WHEN NEW."issue_id" <> OLD."issue_id" THEN 'issue_id'
                     WHEN NEW."created_at" <> OLD."created_at" THEN 'created_at'
                     ELSE NULL
                END
            ),
            "synced_at" = NULL
        WHERE "id" = NEW."id";
    ELSE
        -- The row is not present in the local table, insert it
        INSERT INTO "comment_local" (
            "id",
            "body",
            "username",
            "issue_id",
            "created_at",
            "changed_columns",
            "synced_at"
        )
        VALUES (
            NEW."id",
            NEW."body",
            NEW."username",
            NEW."issue_id",
            NEW."created_at",
            ARRAY['body', 'username', 'issue_id', 'created_at'],
            NULL
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER comment_update
INSTEAD OF UPDATE ON "comment"
FOR EACH ROW
EXECUTE FUNCTION comment_update_trigger();

-- The delete trigger for comments
CREATE OR REPLACE FUNCTION comment_delete_trigger()
RETURNS TRIGGER AS $$
BEGIN
    -- Is the row present in the local table?
    IF EXISTS (SELECT 1 FROM "comment_local" WHERE "id" = OLD."id") THEN
        -- Set the "is_deleted" flag to true for the row in the local table
        UPDATE "comment_local"
        SET 
            "is_deleted" = TRUE,
            "synced_at" = NULL
        WHERE "id" = OLD."id";
    ELSE
        -- The row is not present in the local table, insert it
        INSERT INTO "comment_local" (
            "id",
            "is_deleted",
            "synced_at"
        )
        VALUES (
            OLD."id",
            TRUE,
            NULL
        );
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER comment_delete
INSTEAD OF DELETE ON "comment"
FOR EACH ROW
EXECUTE FUNCTION comment_delete_trigger();

-- Add a trigger that deletes the row from the local table if the row in the synced table is deleted

CREATE OR REPLACE FUNCTION delete_local_comment_row_on_synced_delete()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM "comment_local" WHERE "id" = OLD."id";
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER delete_local_row_on_synced_delete
AFTER DELETE ON "comment_synced"
FOR EACH ROW
EXECUTE FUNCTION delete_local_comment_row_on_synced_delete();

CREATE OR REPLACE FUNCTION delete_local_issue_row_on_synced_delete()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM "issue_local" WHERE "id" = OLD."id";
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER delete_local_row_on_synced_delete
AFTER DELETE ON "issue_synced"
FOR EACH ROW
EXECUTE FUNCTION delete_local_issue_row_on_synced_delete();

-- Add triggers to the synced tables that will remove the row from the local table if
-- the row in the synced table has a version that is grater than the synced_at version
-- in the local table.

-- Function to remove local issue row when synced version is greater
CREATE OR REPLACE FUNCTION remove_local_issue_row_on_sync()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM "issue_local"
    WHERE "id" = NEW."id" AND "synced_at" IS NOT NULL AND NEW."version" >= "synced_at";
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to remove local issue row when synced version is greater
CREATE OR REPLACE TRIGGER remove_local_issue_row_on_sync_trigger
AFTER INSERT OR UPDATE ON "issue_synced"
FOR EACH ROW
EXECUTE FUNCTION remove_local_issue_row_on_sync();

-- Function to remove local comment row when synced version is greater
CREATE OR REPLACE FUNCTION remove_local_comment_row_on_sync()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM "comment_local"
    WHERE "id" = NEW."id" AND "synced_at" IS NOT NULL AND NEW."version" >= "synced_at";
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to remove local comment row when synced version is greater
CREATE OR REPLACE TRIGGER remove_local_comment_row_on_sync_trigger
AFTER INSERT OR UPDATE ON "comment_synced"
FOR EACH ROW
EXECUTE FUNCTION remove_local_comment_row_on_sync();
