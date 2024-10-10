-- Create the tables for the linearlite example
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
    CONSTRAINT "issue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE  IF NOT EXISTS "comment" (
    "id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "issue_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,
    "version" BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "comment_pkey" PRIMARY KEY ("id"),
    FOREIGN KEY (issue_id) REFERENCES issue(id) ON DELETE CASCADE
);

-- Triggers to update the version column on insert/update
CREATE OR REPLACE FUNCTION update_version()
RETURNS TRIGGER AS $$
BEGIN
    NEW.version := OLD.version + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_issue_version
BEFORE UPDATE ON issue
FOR EACH ROW
EXECUTE PROCEDURE update_version();

CREATE TRIGGER update_comment_version
BEFORE UPDATE ON comment
FOR EACH ROW
EXECUTE PROCEDURE update_version();
