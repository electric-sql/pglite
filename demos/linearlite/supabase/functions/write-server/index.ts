// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { Hono } from 'jsr:@hono/hono'
import { cors } from 'jsr:@hono/hono/cors'
import postgres from 'https://deno.land/x/postgresjs/mod.js'
import { z } from 'https://deno.land/x/zod/mod.ts'

const issueChangeSchema = z.object({
  id: z.string(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  priority: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  modified: z.string().nullable().optional(),
  created: z.string().nullable().optional(),
  kanbanorder: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  modified_columns: z.array(z.string()).nullable().optional(),
  deleted: z.boolean().nullable().optional(),
  new: z.boolean().nullable().optional(),
})

type IssueChange = z.infer<typeof issueChangeSchema>

const commentChangeSchema = z.object({
  id: z.string(),
  body: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  issue_id: z.string().nullable().optional(),
  modified: z.string().nullable().optional(),
  created: z.string().nullable().optional(),
  modified_columns: z.array(z.string()).nullable().optional(),
  deleted: z.boolean().nullable().optional(),
  new: z.boolean().nullable().optional(),
})

type CommentChange = z.infer<typeof commentChangeSchema>

const changeSetSchema = z.object({
  issues: z.array(issueChangeSchema),
  comments: z.array(commentChangeSchema),
})

type ChangeSet = z.infer<typeof changeSetSchema>

const DATABASE_URL = Deno.env.get('SUPABASE_DB_URL')!

// Create postgres connection
const sql = postgres(DATABASE_URL)

const app = new Hono()

// Middleware
app.use('/write-server/*', cors())

// Routes
app.get('/write-server/', async (c) => {
  const result = await sql`
    SELECT 'ok' as status, version() as postgres_version, now() as server_time
  `
  return c.json(result[0])
})

app.post('/write-server/apply-changes', async (c) => {
  const content = await c.req.json()
  let parsedChanges: ChangeSet
  try {
    parsedChanges = changeSetSchema.parse(content)
    // Any additional validation of the changes can be done here!
  } catch (error) {
    console.error(error)
    return c.json({ error: 'Invalid changes' }, 400)
  }
  const changeResponse = await applyChanges(parsedChanges)
  return c.json(changeResponse)
})

async function applyChanges(changes: ChangeSet): Promise<{ success: boolean }> {
  const { issues, comments } = changes

  try {
    await sql.begin(async (sql) => {
      for (const issue of issues) {
        await applyTableChange('issue', issue, sql)
      }
      for (const comment of comments) {
        await applyTableChange('comment', comment, sql)
      }
    })
    return { success: true }
  } catch (error) {
    throw error
  }
}

async function applyTableChange(
  tableName: 'issue' | 'comment',
  change: IssueChange | CommentChange,
  sql: postgres.TransactionSql
): Promise<void> {
  const {
    id,
    modified_columns: modified_columns_raw,
    new: isNew,
    deleted,
  } = change
  const modified_columns = modified_columns_raw as (keyof typeof change)[]

  if (deleted) {
    await sql`
      DELETE FROM ${sql(tableName)} WHERE id = ${id}
    `
  } else if (isNew) {
    await sql`
      INSERT INTO ${sql(tableName)} ${sql(change, 'id', ...modified_columns)}
    `
  } else {
    await sql`
      UPDATE ${sql(tableName)} 
      SET ${sql(change, ...modified_columns)}
      WHERE id = ${id}
    `
  }
}

Deno.serve(app.fetch)
