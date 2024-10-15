import express from 'express'
import bodyParser from 'body-parser'
import cors from 'cors'
import pg from 'pg'
import {
  ChangeSet,
  changeSetSchema,
  CommentChange,
  IssueChange,
} from './src/utils/changes'

const DATABASE_URL = process.env.DATABASE_URL

const { Client } = pg
const client = new Client(DATABASE_URL)
client.connect()

const app = express()

app.use(bodyParser.json())
app.use(cors())

app.get('/', async (_req, res) => {
  const result = await client.query(
    "SELECT 'ok' as status, version() as postgres_version, now() as server_time"
  )
  res.send(result.rows[0])
})

app.post('/apply-changes', async (req, res) => {
  const content = req.body
  let parsedChanges: ChangeSet
  try {
    parsedChanges = changeSetSchema.parse(content)
    // Any additional validation of the changes can be done here!
  } catch (error) {
    console.error(error)
    res.status(400).send('Invalid changes')
    return
  }
  const changeResponse = await applyChanges(parsedChanges)
  res.send(changeResponse)
})

app.listen(3001, () => {
  console.log('Server is running on port 3001')
})

async function applyChanges(changes: ChangeSet): Promise<void> {
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
