import { worker } from '@electric-sql/pglite/worker'
import { PGlite, Mutex } from '@electric-sql/pglite'
import { live, type PGliteWithLive } from '@electric-sql/pglite/live'
import { electricSync } from '@electric-sql/pglite-sync'
import { migrate } from './migrations'
import type {
  IssueChange,
  CommentChange,
  ChangeSet,
  ChangeResponse,
} from './utils/changes'

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
      table: 'issue_synced',
      primaryKey: ['id'],
      shapeKey: 'issues',
    })
    // await pg.sync.syncShapeToTable({
    //   shape: {
    //     url: `${ELECTRIC_URL}/v1/shape/comment`,
    //   },
    //   table: 'comment_synced',
    //   primaryKey: ['id'],
    //   shapeKey: 'comments',
    // })
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
        (SELECT count(id) as issue_count FROM issue_local WHERE synced_at IS NULL),
        (SELECT count(id) as comment_count FROM comment_local WHERE synced_at IS NULL)
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
        changed_columns,
        is_new,
        is_deleted
      FROM issue_local 
      WHERE synced_at IS NULL
    `)
    const commentRes = await tx.query<CommentChange>(`
      SELECT
        id,
        body,
        username,
        issue_id,
        created_at,
        changed_columns,
        is_new,
        is_deleted
      FROM comment_local WHERE synced_at IS NULL
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
  const changeResponse = (await response.json()) as ChangeResponse
  const { issueVersions, commentVersions } = changeResponse
  await pg.transaction(async (tx) => {
    for (const { id, version } of issueVersions) {
      await tx.sql`
        UPDATE issue_local SET synced_at = ${version} WHERE id = ${id}
      `
    }
    for (const { id, version } of commentVersions) {
      await tx.sql`
        UPDATE comment_local SET synced_at = ${version} WHERE id = ${id}
      `
    }
  })
}
