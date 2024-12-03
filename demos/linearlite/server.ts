import { Hono } from 'hono'
import { cors } from 'hono/cors'
import postgres from 'postgres'
import {
  ChangeSet,
  changeSetSchema,
  CommentChange,
  IssueChange,
} from './src/utils/changes'
import { serve } from '@hono/node-server'

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:password@localhost:54321/linearlite'

// Create postgres connection
const sql = postgres(DATABASE_URL)

const app = new Hono()

// Middleware
app.use('/*', cors())

// Routes
app.get('/', async (c) => {
  const result = await sql`
    SELECT 'ok' as status, version() as postgres_version, now() as server_time
  `
  return c.json(result[0])
})

app.post('/apply-changes', async (c) => {
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

// Start the server
const port = 3001
console.log(`Server is running on port ${port}`)

serve({
  fetch: app.fetch,
  port,
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
  const { id, modified_columns, new: isNew, deleted } = change

  if (deleted) {
    await sql`
      DELETE FROM ${sql(tableName)} WHERE id = ${id}
    `
  } else if (isNew) {
    const columns = modified_columns || []
    const values = columns.map((col) => change[col])

    await sql`
      INSERT INTO ${sql(tableName)} (id, ${sql(columns)})
      VALUES (${id}, ${sql(values)})
    `
  } else {
    const columns = modified_columns || []
    const updates = columns
      .map((col) => ({ [col]: change[col] }))
      .reduce((acc, curr) => ({ ...acc, ...curr }), {})

    await sql`
      UPDATE ${sql(tableName)} 
      SET ${sql(updates)}
      WHERE id = ${id}
    `
  }
}
