import postgres from 'postgres'
import { generateIssues } from './generate_data.js'

if (!process.env.DATABASE_URL) {
  throw new Error(`DATABASE_URL is not set`)
}

const DATABASE_URL = process.env.DATABASE_URL
const ISSUES_TO_LOAD = process.env.ISSUES_TO_LOAD || 512
const BATCH_SIZE = 1000
const issues = generateIssues(ISSUES_TO_LOAD)

console.info(`Connecting to Postgres at ${DATABASE_URL}`)
const sql = postgres(DATABASE_URL)

async function batchInsert(sql, table, columns, dataArray, batchSize = 1000) {
  for (let i = 0; i < dataArray.length; i += batchSize) {
    const batch = dataArray.slice(i, i + batchSize)

    await sql`
      INSERT INTO ${sql(table)} ${sql(batch, columns)}
    `

    process.stdout.write(
      `Loaded ${Math.min(i + batchSize, dataArray.length)} of ${dataArray.length} ${table}s\r`
    )
  }
}

const issueCount = issues.length
let commentCount = 0

try {
  // Process data in batches
  for (let i = 0; i < issues.length; i += BATCH_SIZE) {
    const issueBatch = issues.slice(i, i + BATCH_SIZE)
    
    await sql.begin(async (sql) => {
      // Disable FK checks
      await sql`SET CONSTRAINTS ALL DEFERRED`

      // Insert issues
      const issuesData = issueBatch.map(({ comments: _, ...rest }) => rest)
      const issueColumns = Object.keys(issuesData[0])
      await batchInsert(sql, 'issue', issueColumns, issuesData, BATCH_SIZE)

      // Insert related comments
      const batchComments = issueBatch.flatMap((issue) => issue.comments)
      const commentColumns = Object.keys(batchComments[0])
      await batchInsert(sql, 'comment', commentColumns, batchComments, BATCH_SIZE)

      commentCount += batchComments.length
    })

    process.stdout.write(`\nProcessed batch ${Math.floor(i / BATCH_SIZE) + 1}: ${Math.min(i + BATCH_SIZE, issues.length)} of ${issues.length} issues\n`)
  }

  console.info(`Loaded ${issueCount} issues with ${commentCount} comments.`)
} catch (error) {
  console.error('Error loading data:', error)
  throw error
} finally {
  await sql.end()
}
