import type { PGliteInterface, Transaction } from '@electric-sql/pglite-base'
import type { Offset } from '@electric-sql/client'
import { SubscriptionKey, Lsn } from './types'

const subscriptionTableName = `subscriptions_metadata`

export interface SubscriptionState {
  key: SubscriptionKey
  shape_metadata: Record<string, ShapeSubscriptionState>
  last_lsn: Lsn
}

export interface ShapeSubscriptionState {
  handle: string
  offset: Offset
}

export interface GetSubscriptionStateOptions {
  readonly pg: PGliteInterface | Transaction
  readonly metadataSchema: string
  readonly subscriptionKey: SubscriptionKey
}

/**
 * Get the subscription state for a given key.
 * @param options - The options for the subscription state.
 * @returns The subscription state or null if it does not exist.
 */
export async function getSubscriptionState({
  pg,
  metadataSchema,
  subscriptionKey,
}: GetSubscriptionStateOptions): Promise<SubscriptionState | null> {
  const result = await pg.query<SubscriptionState>(
    `
      SELECT key, shape_metadata, last_lsn
      FROM ${subscriptionMetadataTableName(metadataSchema)}
      WHERE key = $1
    `,
    [subscriptionKey],
  )

  if (result.rows.length === 0) {
    return null
  } else if (result.rows.length > 1) {
    throw new Error(`Multiple subscriptions found for key: ${subscriptionKey}`)
  }

  const res = result.rows[0]

  if (typeof res.last_lsn === 'string') {
    return {
      ...res,
      last_lsn: BigInt(res.last_lsn),
    }
  } else {
    throw new Error(`Invalid last_lsn type: ${typeof res.last_lsn}`)
  }
}

export interface UpdateSubscriptionStateOptions {
  pg: PGliteInterface | Transaction
  metadataSchema: string
  subscriptionKey: SubscriptionKey
  shapeMetadata: Record<string, ShapeSubscriptionState>
  lastLsn: Lsn
  debug?: boolean
}

/**
 * Update the subscription state for a given key.
 * @param options - The options for the subscription state.
 */
export async function updateSubscriptionState({
  pg,
  metadataSchema,
  subscriptionKey,
  shapeMetadata,
  lastLsn,
  debug,
}: UpdateSubscriptionStateOptions) {
  if (debug) {
    console.log(
      'updating subscription state',
      subscriptionKey,
      shapeMetadata,
      lastLsn,
    )
  }
  await pg.query(
    `
      INSERT INTO ${subscriptionMetadataTableName(metadataSchema)}
        (key, shape_metadata, last_lsn)
      VALUES
        ($1, $2, $3)
      ON CONFLICT(key)
      DO UPDATE SET
        shape_metadata = EXCLUDED.shape_metadata,
        last_lsn = EXCLUDED.last_lsn;
    `,
    [subscriptionKey, shapeMetadata, lastLsn.toString()],
  )
}

export interface DeleteSubscriptionStateOptions {
  pg: PGliteInterface | Transaction
  metadataSchema: string
  subscriptionKey: SubscriptionKey
}

/**
 * Delete the subscription state for a given key.
 * @param options - The options for the subscription state.
 */
export async function deleteSubscriptionState({
  pg,
  metadataSchema,
  subscriptionKey,
}: DeleteSubscriptionStateOptions) {
  await pg.query(
    `DELETE FROM ${subscriptionMetadataTableName(metadataSchema)} WHERE key = $1`,
    [subscriptionKey],
  )
}

export interface MigrateSubscriptionMetadataTablesOptions {
  pg: PGliteInterface | Transaction
  metadataSchema: string
}

/**
 * Migrate the subscription metadata tables.
 * @param options - The options for the subscription metadata tables.
 */
export async function migrateSubscriptionMetadataTables({
  pg,
  metadataSchema,
}: MigrateSubscriptionMetadataTablesOptions) {
  await pg.exec(
    `
      SET ${metadataSchema}.syncing = false;
      CREATE SCHEMA IF NOT EXISTS "${metadataSchema}";
      CREATE TABLE IF NOT EXISTS ${subscriptionMetadataTableName(metadataSchema)} (
        key TEXT PRIMARY KEY,
        shape_metadata JSONB NOT NULL,
        last_lsn TEXT NOT NULL
      );
    `,
  )
}

function subscriptionMetadataTableName(metadataSchema: string) {
  return `"${metadataSchema}"."${subscriptionTableName}"`
}
