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

async function makeInsertQuery(db, table, data) {
  const columns = Object.keys(data)
  const columnsNames = columns.join(`, `)
  const values = columns.map((column) => data[column])
  return await db.query(sql`
    INSERT INTO ${sql.ident(table)} (${sql(columnsNames)})
    VALUES (${sql.join(values.map(sql.value), `, `)})
  `)
}

async function importIssue(db, issue) {
  const { comments: _, ...rest } = issue
  return await makeInsertQuery(db, `issue`, rest)
}

async function importComment(db, comment) {
  return await makeInsertQuery(db, `comment`, comment)
}

const issueCount = issues.length
let commentCount = 0
const batchSize = 100
for (let i = 0; i < issueCount; i += batchSize) {
  await db.tx(async (db) => {
    db.query(sql`SET CONSTRAINTS ALL DEFERRED;`) // disable FK checks
    for (let j = i; j < i + batchSize && j < issueCount; j++) {
      process.stdout.write(`Loading issue ${j + 1} of ${issueCount}\r`)
      const issue = issues[j]
      await importIssue(db, issue)
      for (const comment of issue.comments) {
        commentCount++
        await importComment(db, comment)
      }
    }
  })
}

process.stdout.write(`\n`)

db.dispose()
console.info(`Loaded ${issueCount} issues with ${commentCount} comments.`)
