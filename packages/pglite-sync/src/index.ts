import type { Row } from '@electric-sql/client'
import {
  ChangeMessage,
  isChangeMessage,
  isControlMessage,
  ShapeStreamOptions,
} from '@electric-sql/client'
import { MultiShapeStream } from '@electric-sql/experimental'
import type { Extension, PGliteInterface } from '@electric-sql/pglite'
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
} from './types'
import { applyMessageToTable, applyMessagesToTableWithCopy } from './apply'

export * from './types'

async function createPlugin(
  pg: PGliteInterface,
  options?: ElectricSyncOptions,
) {
  const debug = options?.debug ?? false
  const metadataSchema = options?.metadataSchema ?? 'electric'
  const streams: Array<{
    stream: MultiShapeStream<Record<string, Row<unknown>>>
    aborter: AbortController
  }> = []

  // We keep an in-memory lock per table such that two
  // shapes are not synced into one table - this will be
  // resolved by using reference counting in shadow tables
  const shapePerTableLock = new Map<string, void>()

  let initMetadataTablesDone = false
  const initMetadataTables = async () => {
    if (initMetadataTablesDone) return
    initMetadataTablesDone = true
    await migrateSubscriptionMetadataTables({
      pg,
      metadataSchema,
    })
  }

  const syncShapesToTables = async ({
    key,
    shapes,
    useCopy,
    onInitialSync,
  }: SyncShapesToTablesOptions): Promise<SyncShapesToTablesResult> => {
    let unsubscribed = false
    await initMetadataTables()

    Object.values(shapes)
      .filter((shape) => !shape.onMustRefetch) // Shapes with onMustRefetch bypass the lock
      .forEach((shape) => {
        if (shapePerTableLock.has(shape.table)) {
          throw new Error('Already syncing shape for table ' + shape.table)
        }
        shapePerTableLock.set(shape.table)
      })

    let subState: SubscriptionState | null = null

    // if key is not null, ensure persistence of subscription state
    // is possible and check if it is already persisted
    if (key) {
      subState = await getSubscriptionState({
        pg,
        metadataSchema,
        subscriptionKey: key,
      })
      if (debug && subState) {
        console.log('resuming from subscription state', subState)
      }
    }

    // If it's a new subscription there is no state to resume from
    const isNewSubscription = subState === null

    // If it's a new subscription we can do a `COPY FROM` to insert the initial data
    // TODO: in future when we can have multiple shapes on the same table we will need
    // to make sure we only do a `COPY FROM` on the first shape on the table as they
    // may overlap and so the insert logic will be wrong.
    let doCopy = isNewSubscription && useCopy

    // Track if onInitialSync has been called
    let onInitialSyncCalled = false

    // Map of shape name to lsn to changes
    // We accumulate changes for each lsn and then apply them all at once
    const changes = new Map<string, Map<bigint, ChangeMessage<Row<unknown>>[]>>(
      Object.keys(shapes).map((key) => [key, new Map()]),
    )

    // We track the highest completely buffered lsn for each shape
    const completeLsns = new Map<string, bigint>(
      Object.keys(shapes).map((key) => [key, BigInt(-1)]),
    )

    // We track which shapes need a truncate
    // These are truncated at the start of the next commit
    const truncateNeeded = new Set<string>()

    // We also have to track the last lsn that we have committed
    // This is across all shapes
    const lastCommittedLsn: bigint = subState?.last_lsn ?? BigInt(-1)

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
            const offset = shapeMetadata?.offset ?? undefined
            const handle = shapeMetadata?.handle ?? undefined
            return [
              key,
              {
                ...shapeOptions.shape,
                offset,
                handle,
                signal: aborter.signal,
              } satisfies ShapeStreamOptions,
            ]
          }),
        ),
      },
    )

    const commitUpToLsn = async (targetLsn: bigint) => {
      // We need to collect all the messages for each shape that we need to commit
      const messagesToCommit = new Map<string, ChangeMessage<Row<unknown>>[]>(
        Object.keys(shapes).map((shapeName) => [shapeName, []]),
      )
      for (const [shapeName, shapeChanges] of changes.entries()) {
        for (const lsn of shapeChanges.keys()) {
          if (lsn <= targetLsn) {
            messagesToCommit.get(shapeName)!.push(...shapeChanges.get(lsn)!)
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
        tx.exec(`SET LOCAL ${metadataSchema}.syncing = true;`)

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
              await tx.exec(`DELETE FROM ${shape.table};`)
            }
            truncateNeeded.delete(shapeName)
          }

          // Apply the changes to the table
          if (doCopy) {
            // We can do a `COPY FROM` to insert the initial data
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
            if (initialInserts.length > 0) {
              // As `COPY FROM` doesn't trigger a NOTIFY, we pop
              // the last insert message and and add it to the be beginning
              // of the remaining messages to be applied after the `COPY FROM`
              remainingMessages.unshift(initialInserts.pop()!)
            }
            messages = remainingMessages

            // Do the `COPY FROM` with initial inserts
            if (initialInserts.length > 0) {
              applyMessagesToTableWithCopy({
                pg: tx,
                table: shape.table,
                schema: shape.schema,
                messages: initialInserts as InsertChangeMessage[],
                mapColumns: shape.mapColumns,
                primaryKey: shape.primaryKey,
                debug,
              })
              // We don't want to do a `COPY FROM` again after that
              doCopy = false
            }
          }

          for (const changeMessage of messages) {
            await applyMessageToTable({
              pg: tx,
              table: shape.table,
              schema: shape.schema,
              message: changeMessage,
              mapColumns: shape.mapColumns,
              primaryKey: shape.primaryKey,
              debug,
            })
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
          tx.rollback()
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
          if (lsn <= lastCommittedLsnForShape) {
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
        // Await a timeout to start a new task and  allow other connections to do work
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    })

    streams.push({
      stream: multiShapeStream,
      aborter,
    })
    const unsubscribe = () => {
      if (debug) {
        console.log('unsubscribing')
      }
      unsubscribed = true
      multiShapeStream.unsubscribeAll()
      aborter.abort()
      for (const shape of Object.values(shapes)) {
        shapePerTableLock.delete(shape.table)
      }
    }
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
      useCopy: options.useCopy,
      onInitialSync: options.onInitialSync,
    })
    return {
      unsubscribe: multiShapeSub.unsubscribe,
      isUpToDate: multiShapeSub.isUpToDate,
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
    for (const { stream, aborter } of streams) {
      stream.unsubscribeAll()
      aborter.abort()
    }
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
    name: 'ElectricSQL Sync',
    setup: async (pg: PGliteInterface) => {
      const { namespaceObj, close } = await createPlugin(pg, options)
      return {
        namespaceObj,
        close,
      }
    },
  } satisfies Extension
}
