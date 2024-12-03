import { Mutex } from '@electric-sql/pglite'
import { type PGliteWithLive } from '@electric-sql/pglite/live'
import { type PGliteWithSync } from '@electric-sql/pglite-sync'
import type { IssueChange, CommentChange, ChangeSet } from './utils/changes'
import { postInitialSync } from './migrations'
import { useEffect, useState } from 'react'

const WRITE_SERVER_URL = import.meta.env.VITE_WRITE_SERVER_URL
const ELECTRIC_URL = import.meta.env.VITE_ELECTRIC_URL
const APPLY_CHANGES_URL = `${WRITE_SERVER_URL}/apply-changes`

type SyncStatus = 'initial-sync' | 'done'

type PGliteWithExtensions = PGliteWithLive & PGliteWithSync

export async function startSync(pg: PGliteWithExtensions) {
  await startSyncToDatabase(pg)
  startWritePath(pg)
}

async function startSyncToDatabase(pg: PGliteWithExtensions) {
  // Check if there are any issues already in the database
  const issues = await pg.query(`SELECT 1 FROM issue LIMIT 1`)
  const hasIssuesAtStart = issues.rows.length > 0

  let issueShapeInitialSyncDone = false
  let commentShapeInitialSyncDone = false
  let postInitialSyncDone = false

  if (!hasIssuesAtStart && !postInitialSyncDone) {
    updateSyncStatus('initial-sync', 'Downloading shape data...')
  }

  let postInitialSyncDoneResolver: () => void
  const postInitialSyncDonePromise = new Promise<void>((resolve) => {
    postInitialSyncDoneResolver = resolve
  })

  const doPostInitialSync = async () => {
    if (
      !hasIssuesAtStart &&
      issueShapeInitialSyncDone &&
      commentShapeInitialSyncDone &&
      !postInitialSyncDone
    ) {
      postInitialSyncDone = true
      updateSyncStatus('initial-sync', 'Creating indexes...')
      await postInitialSync(pg)
      postInitialSyncDoneResolver()
    }
  }

  // Issues Sync
  const issuesSync = await pg.sync.syncShapeToTable({
    shape: {
      url: `${ELECTRIC_URL}/v1/shape`,
      table: 'issue',
    },
    table: 'issue',
    primaryKey: ['id'],
    shapeKey: 'issues',
    commitGranularity: 'up-to-date',
    useCopy: true,
    onInitialSync: async () => {
      issueShapeInitialSyncDone = true
      await pg.exec(`ALTER TABLE issue ENABLE TRIGGER ALL`)
      doPostInitialSync()
    },
  })
  issuesSync.subscribe(
    () => {
      if (!hasIssuesAtStart && !postInitialSyncDone) {
        updateSyncStatus('initial-sync', 'Inserting issues...')
      }
    },
    (error) => {
      console.error('issuesSync error', error)
    }
  )

  // Comments Sync
  const commentsSync = await pg.sync.syncShapeToTable({
    shape: {
      url: `${ELECTRIC_URL}/v1/shape`,
      table: 'comment',
    },
    table: 'comment',
    primaryKey: ['id'],
    shapeKey: 'comments',
    commitGranularity: 'up-to-date',
    useCopy: true,
    onInitialSync: async () => {
      commentShapeInitialSyncDone = true
      await pg.exec(`ALTER TABLE comment ENABLE TRIGGER ALL`)
      doPostInitialSync()
    },
  })
  commentsSync.subscribe(
    () => {
      if (!hasIssuesAtStart && !postInitialSyncDone) {
        updateSyncStatus('initial-sync', 'Inserting comments...')
      }
    },
    (error) => {
      console.error('commentsSync error', error)
    }
  )

  if (!hasIssuesAtStart) {
    await postInitialSyncDonePromise
    await pg.query(`SELECT 1;`) // Do a query to ensure PGlite is idle
  }
  updateSyncStatus('done')
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

export function updateSyncStatus(newStatus: SyncStatus, message?: string) {
  localStorage.setItem('syncStatus', JSON.stringify([newStatus, message]))
  // Fire a storage event on this tab as this doesn't happen automatically
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: 'syncStatus',
      newValue: JSON.stringify([newStatus, message]),
    })
  )
}

export function useSyncStatus() {
  const currentSyncStatusJson = localStorage.getItem('syncStatus')
  const currentSyncStatus: [SyncStatus, string] = currentSyncStatusJson
    ? JSON.parse(currentSyncStatusJson)
    : ['initial-sync', 'Starting sync...']
  const [syncStatus, setSyncStatus] =
    useState<[SyncStatus, string]>(currentSyncStatus)

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'syncStatus' && e.newValue) {
        const [newStatus, message] = JSON.parse(e.newValue)
        setSyncStatus([newStatus, message])
      }
    }

    window.addEventListener('storage', handleStorageChange)

    return () => {
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [])

  return syncStatus
}

let initialSyncDone = false

export function waitForInitialSyncDone() {
  return new Promise<void>((resolve) => {
    if (initialSyncDone) {
      resolve()
      return
    }
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'syncStatus' && e.newValue) {
        const [newStatus] = JSON.parse(e.newValue)
        if (newStatus === 'done') {
          window.removeEventListener('storage', handleStorageChange)
          initialSyncDone = true
          resolve()
        }
      }
    }

    // Check current status first
    const currentSyncStatusJson = localStorage.getItem('syncStatus')
    const [currentStatus] = currentSyncStatusJson
      ? JSON.parse(currentSyncStatusJson)
      : ['initial-sync']

    if (currentStatus === 'done') {
      initialSyncDone = true
      resolve()
    } else {
      window.addEventListener('storage', handleStorageChange)
    }
  })
}
