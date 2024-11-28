import { Hono } from 'hono'
import { cors } from 'hono/cors'
import pg from 'pg'
import {
  ChangeSet,
  changeSetSchema,
  CommentChange,
  IssueChange,
} from './src/utils/changes'
import { serve } from '@hono/node-server'

const DATABASE_URL = process.env.DATABASE_URL

const { Client } = pg
const client = new Client(DATABASE_URL)
client.connect()

const app = new Hono()

// Middleware
app.use('/*', cors())

// Routes
app.get('/', async (c) => {
  const result = await client.query(
    "SELECT 'ok' as status, version() as postgres_version, now() as server_time"
  )
  return c.json(result.rows[0])
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
  port
})

async function applyChanges(changes: ChangeSet): Promise<{ success: boolean }> {
  const { issues, comments } = changes
  client.query('BEGIN')
  try {
    await client.query('COMMIT')
    for (const issue of issues) {
      await applyTableChange('issue', issue)
    }
    for (const comment of comments) {
      await applyTableChange('comment', comment)
    }
    return { success: true }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

/**
 * Apply a change to the specified table in the database.
 * @param tableName The name of the table to apply the change to
 * @param change The change object containing the data to be applied
 */
async function applyTableChange(
  tableName: 'issue' | 'comment',
  change: IssueChange | CommentChange
): Promise<void> {
  const {
    id,
    modified_columns,
    new: isNew,
    deleted,
  } = change

  if (deleted) {
    await client.query(
      `
        DELETE FROM ${tableName} WHERE id = $1
        -- ON CONFLICT (id) DO NOTHING
      `,
      [id]
    )
  } else if (isNew) {
    const columns = modified_columns || [];
    const values = columns.map(col => change[col]);
    await client.query(
      `
        INSERT INTO ${tableName} (id, ${columns.join(', ')})
        VALUES ($1, ${columns.map((_, index) => `$${index + 2}`).join(', ')})
        -- ON CONFLICT (id) DO NOTHING
      `,
      [id, ...values]
    );
  } else {
    const columns = modified_columns || [];
    const values = columns.map(col => change[col]);
    const updateSet = columns.map((col, index) => `${col} = $${index + 2}`).join(', ');
    await client.query(
      `
        UPDATE ${tableName} SET ${updateSet} WHERE id = $1
        -- ON CONFLICT (id) DO NOTHING
      `,
      [id, ...values]
    );
  }
}
