import { worker } from '@electric-sql/pglite/worker'
import { PGlite, Mutex } from '@electric-sql/pglite'
import { live, type PGliteWithLive } from '@electric-sql/pglite/live'
import { electricSync, type PGliteWithSync } from '@electric-sql/pglite-sync'
import { migrate } from './migrations'
import type { IssueChange, CommentChange, ChangeSet } from './utils/changes'

const WRITE_SERVER_URL = import.meta.env.VITE_WRITE_SERVER_URL
const ELECTRIC_URL = import.meta.env.VITE_ELECTRIC_URL
const APPLY_CHANGES_URL = `${WRITE_SERVER_URL}/apply-changes`

type PGliteWithExtensions = PGliteWithLive & PGliteWithSync

worker({
  async init() {
    const pg = await PGlite.create({
      // debug: 1,
      dataDir: 'idb://linearlite2',
      relaxedDurability: true,
      extensions: {
        sync: electricSync(),
        live,
      },
    })

    // Migrate the database to the latest schema
    await migrate(pg)

    // This waits for the last weeks data to sync to the database
    await startSyncToDatabase(pg)

    startWritePath(pg)

    return pg
  },
})

const INITIAL_SYNC_DAYS = 7
// We can set this to a specific date to sync from, or leave it blank to sync from 30 days ago
// this is used for the demo to sync from a specific date based on what we have in the demo data
const INITIAL_SYNC_FROM_DATE = import.meta.env.VITE_INITIAL_SYNC_FROM_DATE ?? '2024-11-28T00:00:00.000Z'

async function initialSyncToDatabase(pg: PGliteWithExtensions) {
  // We are going to first sync just the last weeks data.
  // To make this cache efficient lets sync to the previous Monday that is at least
  // 7 days prior to today.
  const today = new Date()
  const syncFrom = new Date(INITIAL_SYNC_FROM_DATE ?? today)
  if (!INITIAL_SYNC_FROM_DATE) {
    syncFrom.setDate(
      today.getDate() - (INITIAL_SYNC_DAYS + ((today.getDay() + 6) % 7))
    )
  }

  console.log('syncing from', syncFrom.toISOString())

  const issuesSync = await pg.sync.syncShapeToTable({
    shape: {
      url: `${ELECTRIC_URL}/v1/shape`,
      table: 'issue',
      where: `created >= '${syncFrom.toISOString()}'`,
    },
    table: 'issue',
    primaryKey: ['id'],
  })
  const issueSyncUpToDate = new Promise<void>((resolve, reject) => {
    issuesSync.subscribe(() => {
      // Subscribe will be called when the sync is up to date
      // at which point we can unsubscribe and resolve the promise
      console.log('issue sync up to date')
      issuesSync.unsubscribe()
      resolve()
    }, reject)
  })
  const commentsSync = await pg.sync.syncShapeToTable({
    shape: {
      url: `${ELECTRIC_URL}/v1/shape`,
      table: 'comment',
      where: `created >= '${syncFrom.toISOString()}'`,
    },
    table: 'comment',
    primaryKey: ['id'],
  })
  const commentSyncUpToDate = new Promise<void>((resolve, reject) => {
    commentsSync.subscribe(() => {
      // Subscribe will be called when the sync is up to date
      // at which point we can unsubscribe and resolve the promise
      console.log('comment sync up to date')
      commentsSync.unsubscribe()
      resolve()
    }, reject)
  })
  // Wait for both syncs to complete
  await Promise.all([issueSyncUpToDate, commentSyncUpToDate])
}

async function startSyncToDatabase(pg: PGliteWithExtensions) {
  // First sync the last weeks data if the database is empty
  const issueCount = await pg.query<{ count: number }>(`
    SELECT count(id) as count FROM issue
  `)
  if (issueCount.rows[0].count === 0) {
    console.log('initial sync to database')
    await initialSyncToDatabase(pg)
    console.log('initial sync to database complete')
  }

  // Finally start the full sync
  const throttle = 100 // used during initial sync to prevent too many renders
  pg.sync.syncShapeToTable({
    shape: {
      url: `${ELECTRIC_URL}/v1/shape`,
      table: 'issue',
    },
    table: 'issue',
    primaryKey: ['id'],
    shapeKey: 'issues',
    commitGranularity: 'transaction',
    commitThrottle: throttle,
  })
  pg.sync.syncShapeToTable({
    shape: {
      url: `${ELECTRIC_URL}/v1/shape`,
      table: 'comment',
    },
    table: 'comment',
    primaryKey: ['id'],
    shapeKey: 'comments',
    commitGranularity: 'transaction',
    commitThrottle: throttle,
  })
}

const syncMutex = new Mutex()

async function startWritePath(pg: PGliteWithExtensions) {
  // Use a live query to watch for changes to the local tables that need to be synced
  pg.live.query<{
    issue_count: number
    comment_count: number
  }>(
    `
      SELECT * FROM
        (SELECT count(id) as issue_count FROM issue WHERE synced = false),
        (SELECT count(id) as comment_count FROM comment WHERE synced = false)
    `,
    [],
    async (results) => {
      const { issue_count, comment_count } = results.rows[0]
      if (issue_count > 0 || comment_count > 0) {
        await syncMutex.acquire()
        try {
          doSyncToServer(pg)
        } finally {
          syncMutex.release()
        }
      }
    }
  )
}

// Call wrapped in mutex to prevent multiple syncs from happening at the same time
async function doSyncToServer(pg: PGliteWithExtensions) {
  let issueChanges: IssueChange[]
  let commentChanges: CommentChange[]
  await pg.transaction(async (tx) => {
    const issueRes = await tx.query<IssueChange>(`
      SELECT
        id,
        title,
        description,
        priority,
        status,
        modified,
        created,
        kanbanorder,
        username,
        modified_columns,
        deleted,
        new
      FROM issue
      WHERE synced = false AND sent_to_server = false
    `)
    const commentRes = await tx.query<CommentChange>(`
      SELECT
        id,
        body,
        username,
        issue_id,
        modified,
        created,
        modified_columns,
        deleted,
        new
      FROM comment
      WHERE synced = false AND sent_to_server = false
    `)
    issueChanges = issueRes.rows
    commentChanges = commentRes.rows
  })
  const changeSet: ChangeSet = {
    issues: issueChanges!,
    comments: commentChanges!,
  }
  const response = await fetch(APPLY_CHANGES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(changeSet),
  })
  if (!response.ok) {
    throw new Error('Failed to apply changes')
  }
  await pg.transaction(async (tx) => {
    // Mark all changes as sent to server, but check that the modified timestamp
    // has not changed in the meantime

    tx.exec('SET LOCAL electric.bypass_triggers = true')

    for (const issue of issueChanges!) {
      await tx.query(
        `
        UPDATE issue
        SET sent_to_server = true
        WHERE id = $1 AND modified = $2
      `,
        [issue.id, issue.modified]
      )
    }

    for (const comment of commentChanges!) {
      await tx.query(
        `
        UPDATE comment
        SET sent_to_server = true
        WHERE id = $1 AND modified = $2
      `,
        [comment.id, comment.modified]
      )
    }
  })
}
