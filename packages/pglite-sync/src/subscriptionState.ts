import type { PGliteInterface, Transaction } from '@electric-sql/pglite'
import type { Offset } from '@electric-sql/client'
import { SubscriptionKey } from './types'

export interface SubscriptionState {
  key: SubscriptionKey
  shapeMetadata: ShapeSubscriptionState[]
  lastLsn: number
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

  return result.rows[0]
}

export interface UpdateSubscriptionStateOptions {
  pg: PGliteInterface | Transaction
  metadataSchema: string
  subscriptionKey: SubscriptionKey
  shapeMetadata: Record<string, ShapeSubscriptionState>
  lastLsn: number
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
}: UpdateSubscriptionStateOptions) {
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
    [subscriptionKey, shapeMetadata, lastLsn],
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
        last_lsn NUMERIC NOT NULL
      );
    `,
  )
}

function subscriptionMetadataTableName(metadataSchema: string) {
  return `"${metadataSchema}"."${subscriptionTableName}"`
}

const subscriptionTableName = `subscriptions_metadata`
