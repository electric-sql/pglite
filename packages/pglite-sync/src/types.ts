import type {
  ShapeStreamOptions,
  ShapeStreamInterface,
  Row,
  ChangeMessage,
} from '@electric-sql/client'
import { Transaction } from '@electric-sql/pglite-base'

export type Lsn = bigint

export type MapColumnsMap = Record<string, string>
export type MapColumnsFn = (message: ChangeMessage<any>) => Record<string, any>
export type MapColumns = MapColumnsMap | MapColumnsFn
export type SubscriptionKey = string
export type InitialInsertMethod = 'insert' | 'csv' | 'json' | 'useCopy'

export interface ShapeToTableOptions {
  shape: ShapeStreamOptions
  table: string
  schema?: string
  mapColumns?: MapColumns
  primaryKey: string[]
  onMustRefetch?: (tx: Transaction) => Promise<void>
}

export interface SyncShapesToTablesOptions {
  key: string | null
  shapes: Record<string, ShapeToTableOptions>
  useCopy?: boolean // DEPRECATED: use initialInsertMethod instead
  initialInsertMethod?: InitialInsertMethod
  onInitialSync?: () => void
}

export interface SyncShapesToTablesResult {
  unsubscribe: () => void
  readonly isUpToDate: boolean
  streams: Record<string, ShapeStreamInterface<Row<unknown>>>
}

export interface SyncShapeToTableOptions {
  shape: ShapeStreamOptions
  table: string
  schema?: string
  mapColumns?: MapColumns
  primaryKey: string[]
  shapeKey: string | null
  useCopy?: boolean // DEPRECATED: use initialInsertMethod instead
  initialInsertMethod?: InitialInsertMethod
  onInitialSync?: () => void
  onMustRefetch?: (tx: Transaction) => Promise<void>
}

export interface SyncShapeToTableResult {
  unsubscribe: () => void
  readonly isUpToDate: boolean
  stream: ShapeStreamInterface<Row<unknown>>
}

export interface ElectricSyncOptions {
  debug?: boolean
  metadataSchema?: string
}

export type InsertChangeMessage = ChangeMessage<any> & {
  headers: { operation: 'insert' }
}
