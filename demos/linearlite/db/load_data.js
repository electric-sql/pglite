import createPool, { sql } from '@databases/pg'
import { generateIssues } from './generate_data.js'

if (!process.env.DATABASE_URL) {
  throw new Error(`DATABASE_URL is not set`)
}

const DATABASE_URL = process.env.DATABASE_URL
const ISSUES_TO_LOAD = process.env.ISSUES_TO_LOAD || 512
const issues = generateIssues(ISSUES_TO_LOAD)

console.info(`Connecting to Postgres at ${DATABASE_URL}`)
const db = createPool(DATABASE_URL)

function createBatchInsertQuery(table, columns, dataArray) {
  const valuesSql = dataArray.map(
    (data) =>
      sql`(${sql.join(
        columns.map((column) => sql.value(data[column])),
        sql`, `
      )})`
  )

  return sql`
    INSERT INTO ${sql.ident(table)} (${sql.join(
      columns.map((col) => sql.ident(col)),
      sql`, `
    )})
    VALUES ${sql.join(valuesSql, sql`, `)}
  `
}

const issueCount = issues.length
let commentCount = 0

await db.tx(async (db) => {
  await db.query(sql`SET CONSTRAINTS ALL DEFERRED;`) // disable FK checks

  const batchSize = 1000
  for (let i = 0; i < issueCount; i += batchSize) {
    const issueBatch = issues
      .slice(i, i + batchSize)
      .map(({ comments: _, ...rest }) => rest)
    await db.query(
      createBatchInsertQuery('issue', Object.keys(issueBatch[0]), issueBatch)
    )

    process.stdout.write(
      `Loaded ${Math.min(i + batchSize, issueCount)} of ${issueCount} issues\r`
    )
  }

  const allComments = issues.flatMap((issue) => issue.comments)
  commentCount = allComments.length

  for (let i = 0; i < allComments.length; i += batchSize) {
    const commentBatch = allComments.slice(i, i + batchSize)
    await db.query(
      createBatchInsertQuery(
        'comment',
        Object.keys(commentBatch[0]),
        commentBatch
      )
    )

    process.stdout.write(
      `Loaded ${Math.min(i + batchSize, commentCount)} of ${commentCount} comments\r`
    )
  }
})

process.stdout.write(`\n`)

db.dispose()
console.info(`Loaded ${issueCount} issues with ${commentCount} comments.`)
