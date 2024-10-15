import { worker } from '@electric-sql/pglite/worker'
import { PGlite, Mutex } from '@electric-sql/pglite'
import { live, type PGliteWithLive } from '@electric-sql/pglite/live'
import { electricSync } from '@electric-sql/pglite-sync'
import { migrate } from './migrations'
import type { IssueChange, CommentChange, ChangeSet } from './utils/changes'

const WRITE_SERVER_URL = import.meta.env.VITE_WRITE_SERVER_URL
const ELECTRIC_URL = import.meta.env.VITE_ELECTRIC_URL
const APPLY_CHANGES_URL = `${WRITE_SERVER_URL}/apply-changes`

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
    await migrate(pg)
    await pg.sync.syncShapeToTable({
      shape: {
        url: `${ELECTRIC_URL}/v1/shape/issue`,
      },
      table: 'issue',
      primaryKey: ['id'],
      shapeKey: 'issues',
    })
    await pg.sync.syncShapeToTable({
      shape: {
        url: `${ELECTRIC_URL}/v1/shape/comment`,
      },
      table: 'comment',
      primaryKey: ['id'],
      shapeKey: 'comments',
    })
    startWritePath(pg)
    return pg
  },
})

const syncMutex = new Mutex()

async function startWritePath(pg: PGliteWithLive) {
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
async function doSyncToServer(pg: PGliteWithLive) {
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
