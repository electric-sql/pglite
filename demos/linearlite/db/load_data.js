import postgres from 'postgres'
import { generateIssues } from './generate_data.js'

if (!process.env.DATABASE_URL) {
  throw new Error(`DATABASE_URL is not set`)
}

const DATABASE_URL = process.env.DATABASE_URL
const ISSUES_TO_LOAD = process.env.ISSUES_TO_LOAD || 512
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
  await sql.begin(async (sql) => {
    // Disable FK checks
    await sql`SET CONSTRAINTS ALL DEFERRED`

    // Insert issues
    const issuesData = issues.map(({ comments: _, ...rest }) => rest)
    const issueColumns = Object.keys(issuesData[0])
    await batchInsert(sql, 'issue', issueColumns, issuesData)

    // Insert comments
    const allComments = issues.flatMap((issue) => issue.comments)
    commentCount = allComments.length
    const commentColumns = Object.keys(allComments[0])
    await batchInsert(sql, 'comment', commentColumns, allComments)
  })

  process.stdout.write(`\n`)
  console.info(`Loaded ${issueCount} issues with ${commentCount} comments.`)
} catch (error) {
  console.error('Error loading data:', error)
  throw error
} finally {
  await sql.end()
}
