import express from 'express'
import bodyParser from 'body-parser'
import cors from 'cors'
import pg from 'pg'
import {
  ChangeSet,
  changeSetSchema,
  CommentChange,
  IssueChange,
  ChangeResponse,
  RowChange,
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

async function applyChanges(changes: ChangeSet): Promise<ChangeResponse> {
  const { issues, comments } = changes
  client.query('BEGIN')
  try {
    await client.query('COMMIT')
    const issueVersions = (
      await Promise.all(issues.map(applyIssueChange))
    ).filter((v) => v !== null)
    const commentVersions = (
      await Promise.all(comments.map(applyCommentChange))
    ).filter((v) => v !== null)
    return { issueVersions, commentVersions }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

/**
 * Apply an issue change to the database and return the version of the row after
 * the change.
 * @param issueChange
 */
async function applyIssueChange(
  issueChange: IssueChange
): Promise<RowChange | null> {
  const {
    id,
    title,
    description,
    priority,
    status,
    modified,
    created,
    kanbanorder,
    username,
    changed_columns,
    is_new,
    is_deleted,
  } = issueChange

  if (is_new) {
    const result = await client.query(
      `
      INSERT INTO issue
      (id, title, description, priority, status, modified, created, kanbanorder, username)
      VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING version
    `,
      [
        id,
        title,
        description,
        priority,
        status,
        modified,
        created,
        kanbanorder,
        username,
      ]
    )
    return { id, version: result.rows[0].version }
  } else if (is_deleted) {
    await client.query(
      `
      DELETE FROM issue WHERE id = $1
    `,
      [id]
    )
    return null
  } else if (changed_columns) {
    const setClause = changed_columns
      .map((column, index) => `${column} = $${index + 1}`)
      .join(', ')
    const values = changed_columns.map((column) => issueChange[column])
    values.push(id)

    const result = await client.query(
      `
        UPDATE issue
        SET ${setClause}
        WHERE id = $${changed_columns.length + 1}
        RETURNING version
      `,
      values
    )
    return { id, version: result.rows[0].version }
  } else {
    return null
  }
}

/**
 * Apply a comment change to the database and return the version of the row after
 * the change.
 * @param commentChange
 */
async function applyCommentChange(
  commentChange: CommentChange
): Promise<RowChange | null> {
  const {
    id,
    issue_id,
    body,
    username,
    created_at,
    changed_columns,
    is_new,
    is_deleted,
  } = commentChange

  if (is_new) {
    const result = await client.query(
      `
        INSERT INTO comment
          (id, issue_id, body, username, created_at)
        VALUES
          ($1, $2, $3, $4, $5)
        RETURNING version
      `,
      [id, issue_id, body, username, created_at]
    )
    return { id, version: result.rows[0].version }
  } else if (is_deleted) {
    await client.query(
      `
      DELETE FROM comment WHERE id = $1
    `,
      [id]
    )
    return null
  } else if (changed_columns) {
    const setClause = changed_columns
      .map((column, index) => `${column} = $${index + 1}`)
      .join(', ')
    const values = changed_columns.map((column) => commentChange[column])
    values.push(id)

    const result = await client.query(
      `
        UPDATE comment
        SET ${setClause}
        WHERE id = $${changed_columns.length + 1}
        RETURNING version
      `,
      values
    )
    return { id, version: result.rows[0].version }
  } else {
    return null
  }
}
