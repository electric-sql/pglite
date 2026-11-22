import type { Row } from '@electric-sql/client'
import {
  ChangeMessage,
  isChangeMessage,
  isControlMessage,
  ShapeStreamOptions,
} from '@electric-sql/client'
import { MultiShapeStream } from '@electric-sql/experimental'
import type {
  Extension,
  ExtensionSessionContext,
  PGliteInterface,
} from '@electric-sql/pglite'
import {
  migrateSubscriptionMetadataTables,
  getSubscriptionState,
  updateSubscriptionState,
  deleteSubscriptionState,
  SubscriptionState,
} from './subscriptionState'
import type {
  ElectricSyncOptions,
  SyncShapesToTablesOptions,
  SyncShapesToTablesResult,
  SyncShapeToTableOptions,
  SyncShapeToTableResult,
  InsertChangeMessage,
  Lsn,
} from './types'
import {
  applyInsertsToTable,
  applyMessageToTable,
  applyMessagesToTableWithCopy,
  applyMessagesToTableWithJson,
} from './apply'

export * from './types'

const databaseTableLocks = new WeakMap<ExtensionSessionContext, Set<string>>()

async function createPlugin(
  pg: PGliteInterface,
  options?: ElectricSyncOptions,
  context?: ExtensionSessionContext,
) {
  const debug = options?.debug ?? false
  const metadataSchema = options?.metadataSchema ?? 'electric'
  const subscriptions = new Set<() => void>()
  const tableLocks =
    (context && databaseTableLocks.get(context)) ?? new Set<string>()
  if (context) databaseTableLocks.set(context, tableLocks)
  let closed = false

  let metadataReady: Promise<void> | undefined
  const initMetadataTables = () => {
    metadataReady ??= migrateSubscriptionMetadataTables({
      pg,
      metadataSchema,
    }).catch((error) => {
      metadataReady = undefined
      throw error
    })
    return metadataReady
  }

  const syncShapesToTables = async (options: SyncShapesToTablesOptions) => {
    await initMetadataTables()
    if (closed) throw new Error('Sync session is closed')
    const tables = new Set<string>()
    for (const shape of Object.values(options.shapes)) {
      if (shape.onMustRefetch) continue
      const table = JSON.stringify([shape.schema || 'public', shape.table])
      if (tables.has(table) || tableLocks.has(table)) {
        throw new Error('Already syncing shape for table ' + shape.table)
      }
      tables.add(table)
    }
    for (const table of tables) tableLocks.add(table)
    const release = () => {
      for (const table of tables) tableLocks.delete(table)
      tables.clear()
    }
    subscriptions.add(release)
    try {
      return await startSubscription(options, release)
    } catch (error) {
      release()
      throw error
    } finally {
      subscriptions.delete(release)
    }
  }

  const startSubscription = async (
    {
      key,
      shapes,
      useCopy = false, // DEPRECATED: use initialInsertMethod instead
      initialInsertMethod = 'insert',
      onInitialSync,
      onError,
    }: SyncShapesToTablesOptions,
    release: () => void,
  ): Promise<SyncShapesToTablesResult> => {
    let unsubscribed = false
    let subState: SubscriptionState | null = null

    // if key is not null, ensure persistence of subscription state
    // is possible and check if it is already persisted
    if (key !== null) {
      subState = await getSubscriptionState({
        pg,
        metadataSchema,
        subscriptionKey: key,
      })
      if (debug && subState) {
        console.log('resuming from subscription state', subState)
      }
    }

    if (closed) throw new Error('Sync session is closed')

    // If it's a new subscription there is no state to resume from
    const isNewSubscription = subState === null

    // We need to handle the old useCopy option
    // We check if it's set to true and initialInsertMethod is it's default value
    if (useCopy && initialInsertMethod === 'insert') {
      initialInsertMethod = 'csv'
      console.warn(
        'The useCopy option is deprecated and will be removed in a future version. Use initialInsertMethod instead.',
      )
    }

    // If it's a new subscription we can do a `COPY FROM` to insert the initial data
    // TODO: in future when we can have multiple shapes on the same table we will need
    // to make sure we only do a `COPY FROM` on the first shape on the table as they
    // may overlap and so the insert logic will be wrong.
    let useInsert = !isNewSubscription || initialInsertMethod === 'insert'

    // Track if onInitialSync has been called
    let onInitialSyncCalled = false

    // Map of shape name to lsn to changes
    // We accumulate changes for each lsn and then apply them all at once
    const changes = new Map<string, Map<Lsn, ChangeMessage<Row<unknown>>[]>>(
      Object.keys(shapes).map((key) => [key, new Map()]),
    )

    // We track the highest completely buffered lsn for each shape
    const completeLsns = new Map<string, Lsn>(
      Object.keys(shapes).map((key) => [key, BigInt(-1)]),
    )

    // We track which shapes need a truncate
    // These are truncated at the start of the next commit
    const truncateNeeded = new Set<string>()

    // We also have to track the last lsn that we have committed
    // This is across all shapes
    const lastCommittedLsn: Lsn = subState?.last_lsn ?? BigInt(-1)

    // We need our own aborter to be able to abort the streams but still accept the
    // signals from the user for each shape, and so we monitor the user provided signal
    // for each shape and abort our own aborter when the user signal is aborted.
    const aborter = new AbortController()
    Object.values(shapes)
      .filter((shapeOptions) => !!shapeOptions.shape.signal)
      .forEach((shapeOptions) => {
        shapeOptions.shape.signal!.addEventListener(
          'abort',
          () => aborter.abort(),
          {
            once: true,
          },
        )
      })

    const multiShapeStream = new MultiShapeStream<Record<string, Row<unknown>>>(
      {
        shapes: Object.fromEntries(
          Object.entries(shapes).map(([key, shapeOptions]) => {
            const shapeMetadata = subState?.shape_metadata[key]
            return [
              key,
              {
                ...shapeOptions.shape,
                ...(shapeMetadata
                  ? {
                      offset: shapeMetadata.offset,
                      handle: shapeMetadata.handle,
                    }
                  : {}),
                signal: aborter.signal,
              } satisfies ShapeStreamOptions,
            ]
          }),
        ),
      },
    )

    const insertMethods = {
      json: applyMessagesToTableWithJson,
      csv: applyMessagesToTableWithCopy,
      useCopy: applyMessagesToTableWithCopy,
      insert: applyInsertsToTable,
    } as const

    const commitUpToLsn = async (targetLsn: Lsn) => {
      // We need to collect all the messages for each shape that we need to commit
      const messagesToCommit = new Map<string, ChangeMessage<Row<unknown>>[]>(
        Object.keys(shapes).map((shapeName) => [shapeName, []]),
      )
      for (const [shapeName, shapeChanges] of changes.entries()) {
        const messagesForShape = messagesToCommit.get(shapeName)!
        for (const lsn of shapeChanges.keys()) {
          if (lsn <= targetLsn) {
            for (const message of shapeChanges.get(lsn)!) {
              messagesForShape.push(message)
            }
            shapeChanges.delete(lsn)
          }
        }
      }

      await pg.transaction(async (tx) => {
        if (debug) {
          console.time('commit')
        }

        // Set the syncing flag to true during this transaction so that
        // user defined triggers on the table are able to chose how to run
        // during a sync
        await tx.exec(`SET LOCAL ${metadataSchema}.syncing = true;`)

        for (const [shapeName, initialMessages] of messagesToCommit.entries()) {
          const shape = shapes[shapeName]
          let messages = initialMessages

          // If we need to truncate the table, do so
          if (truncateNeeded.has(shapeName)) {
            if (debug) {
              console.log('truncating table', shape.table)
            }
            if (shape.onMustRefetch) {
              await shape.onMustRefetch(tx)
            } else {
              const schema = shape.schema || 'public'
              await tx.exec(`DELETE FROM "${schema}"."${shape.table}";`)
            }
            truncateNeeded.delete(shapeName)
          }

          // Apply the changes to the table
          if (!useInsert) {
            // We can do a `COPY FROM`/json_to_recordset to insert the initial data
            // Split messageAggregator into initial inserts and remaining messages
            const initialInserts: InsertChangeMessage[] = []
            const remainingMessages: ChangeMessage<any>[] = []
            let foundNonInsert = false
            for (const message of messages) {
              if (!foundNonInsert && message.headers.operation === 'insert') {
                initialInserts.push(message as InsertChangeMessage)
              } else {
                foundNonInsert = true
                remainingMessages.push(message)
              }
            }
            if (initialInserts.length > 0 && initialInsertMethod === 'csv') {
              // As `COPY FROM` doesn't trigger a NOTIFY, we pop
              // the last insert message and and add it to the be beginning
              // of the remaining messages to be applied after the `COPY FROM`
              remainingMessages.unshift(initialInserts.pop()!)
            }
            messages = remainingMessages

            // Do the `COPY FROM`/json_to_recordset with initial inserts
            if (initialInserts.length > 0) {
              await insertMethods[initialInsertMethod]({
                pg: tx,
                table: shape.table,
                schema: shape.schema,
                messages: initialInserts as InsertChangeMessage[],
                mapColumns: shape.mapColumns,
                primaryKey: shape.primaryKey,
                debug,
              })

              // We don't want to do a `COPY FROM`/json_to_recordset again after that
              useInsert = true
            }
          }

          const bulkInserts: InsertChangeMessage[] = []
          let change: ChangeMessage<any> | null = null
          const messagesLength = messages.length
          for (let i = 0; i < messagesLength; i++) {
            const changeMessage = messages[i]
            if (changeMessage.headers.operation === 'insert') {
              bulkInserts.push(changeMessage as InsertChangeMessage)
            } else {
              change = changeMessage
            }

            if (change || i === messagesLength - 1) {
              if (bulkInserts.length > 0) {
                await applyInsertsToTable({
                  pg: tx,
                  table: shape.table,
                  schema: shape.schema,
                  messages: bulkInserts as InsertChangeMessage[],
                  mapColumns: shape.mapColumns,
                  primaryKey: shape.primaryKey,
                  debug,
                })
                bulkInserts.length = 0
              }
              if (change) {
                await applyMessageToTable({
                  pg: tx,
                  table: shape.table,
                  schema: shape.schema,
                  message: change,
                  mapColumns: shape.mapColumns,
                  primaryKey: shape.primaryKey,
                  debug,
                })
                change = null
              }
            }
          }
        }

        if (key) {
          await updateSubscriptionState({
            pg: tx,
            metadataSchema,
            subscriptionKey: key,
            shapeMetadata: Object.fromEntries(
              Object.keys(shapes).map((shapeName) => [
                shapeName,
                {
                  handle: multiShapeStream.shapes[shapeName].shapeHandle!,
                  offset: multiShapeStream.shapes[shapeName].lastOffset,
                },
              ]),
            ),
            lastLsn: targetLsn,
            debug,
          })
        }
        if (unsubscribed) {
          await tx.rollback()
        }
      })
      if (debug) console.timeEnd('commit')
      if (
        onInitialSync &&
        !onInitialSyncCalled &&
        multiShapeStream.isUpToDate
      ) {
        onInitialSync()
        onInitialSyncCalled = true
      }
    }

    multiShapeStream.subscribe(async (messages) => {
      if (unsubscribed) {
        return
      }
      if (debug) {
        console.log('received messages', messages.length)
      }
      messages.forEach((message) => {
        const lastCommittedLsnForShape =
          completeLsns.get(message.shape) ?? BigInt(-1) // we default to -1 if there are no previous changes
        if (isChangeMessage(message)) {
          const shapeChanges = changes.get(message.shape)!
          const lsn =
            typeof message.headers.lsn === 'string'
              ? BigInt(message.headers.lsn)
              : BigInt(0) // we default to 0 if there no lsn on the message

          // Move-in messages from subquery-based shapes don't have an LSN
          // because they come from direct DB queries, not from replication.
          // We should never skip these based on LSN filtering.
          const isMoveIn =
            (message.headers as Record<string, unknown>).is_move_in === true

          if (!isMoveIn && lsn <= lastCommittedLsnForShape) {
            // We are replaying changes / have already seen this lsn
            // skip and move on to the next message
            return
          }
          const isLastOfLsn =
            (message.headers.last as boolean | undefined) ?? false
          if (!shapeChanges.has(lsn)) {
            shapeChanges.set(lsn, [])
          }
          shapeChanges.get(lsn)!.push(message)
          if (isLastOfLsn) {
            completeLsns.set(message.shape, lsn)
          }
        } else if (isControlMessage(message)) {
          switch (message.headers.control) {
            case 'up-to-date': {
              // Update the complete lsn for this shape
              if (debug) {
                console.log('received up-to-date', message)
              }
              if (typeof message.headers.global_last_seen_lsn !== `string`) {
                throw new Error(`global_last_seen_lsn is not a string`)
              }
              const globalLastSeenLsn = BigInt(
                message.headers.global_last_seen_lsn,
              )
              if (globalLastSeenLsn <= lastCommittedLsnForShape) {
                // We are replaying changes / have already seen this lsn
                // skip and move on to the next message
                return
              }
              completeLsns.set(message.shape, globalLastSeenLsn)
              break
            }
            case 'must-refetch': {
              // Reset the changes for this shape
              if (debug) {
                console.log('received must-refetch', message)
              }
              const shapeChanges = changes.get(message.shape)!
              shapeChanges.clear()
              completeLsns.set(message.shape, BigInt(-1))
              // Track that we need to truncate the table for this shape
              truncateNeeded.add(message.shape)
              break
            }
          }
        }
      })
      const lowestCommittedLsn = Array.from(completeLsns.values()).reduce(
        (m, e) => (e < m ? e : m), // Min of all complete lsn
      )

      // Normal commit needed
      const isCommitNeeded = lowestCommittedLsn > lastCommittedLsn
      // We've had a must-refetch and are catching up on one of the shape
      const isMustRefetchAndCatchingUp =
        lowestCommittedLsn >= lastCommittedLsn && truncateNeeded.size > 0

      if (isCommitNeeded || isMustRefetchAndCatchingUp) {
        // We have new changes to commit
        commitUpToLsn(lowestCommittedLsn)
        // Await a timeout to start a new task and allow other connections to do work
        await new Promise((resolve) => setTimeout(resolve))
      }
    }, onError)

    const unsubscribe = () => {
      if (unsubscribed) return
      if (debug) console.log('unsubscribing')
      unsubscribed = true
      try {
        multiShapeStream.unsubscribeAll()
      } finally {
        aborter.abort()
        release()
        subscriptions.delete(unsubscribe)
      }
    }
    subscriptions.add(unsubscribe)
    return {
      unsubscribe,
      get isUpToDate() {
        return multiShapeStream.isUpToDate
      },
      streams: Object.fromEntries(
        Object.keys(shapes).map((shapeName) => [
          shapeName,
          multiShapeStream.shapes[shapeName],
        ]),
      ),
    }
  }

  const syncShapeToTable = async (
    options: SyncShapeToTableOptions,
  ): Promise<SyncShapeToTableResult> => {
    const multiShapeSub = await syncShapesToTables({
      shapes: {
        shape: {
          shape: options.shape,
          table: options.table,
          schema: options.schema,
          mapColumns: options.mapColumns,
          primaryKey: options.primaryKey,
          onMustRefetch: options.onMustRefetch,
        },
      },
      key: options.shapeKey,
      useCopy: options.useCopy, // DEPRECATED: use initialInsertMethod instead
      initialInsertMethod: options.initialInsertMethod,
      onInitialSync: options.onInitialSync,
      onError: options.onError,
    })
    return {
      unsubscribe: multiShapeSub.unsubscribe,
      get isUpToDate() {
        return multiShapeSub.isUpToDate
      },
      stream: multiShapeSub.streams.shape,
    }
  }
  const deleteSubscription = async (key: string) => {
    await deleteSubscriptionState({
      pg,
      metadataSchema,
      subscriptionKey: key,
    })
  }

  const namespaceObj = {
    initMetadataTables,
    syncShapesToTables,
    syncShapeToTable,
    deleteSubscription,
  }

  const close = async () => {
    closed = true
    for (const unsubscribe of subscriptions) unsubscribe()
  }

  return {
    namespaceObj,
    close,
  }
}

export type SyncNamespaceObj = Awaited<
  ReturnType<typeof createPlugin>
>['namespaceObj']

export type PGliteWithSync = PGliteInterface & {
  sync: SyncNamespaceObj
}

export function electricSync(options?: ElectricSyncOptions) {
  return {
    name: 'Postgres Sync',
    setup: async (
      pg: PGliteInterface,
      _moduleOptions?: unknown,
      _clientOnly?: boolean,
      context?: ExtensionSessionContext,
    ) => {
      const { namespaceObj, close } = await createPlugin(pg, options, context)
      return {
        namespaceObj,
        close,
      }
    },
  } satisfies Extension
}
