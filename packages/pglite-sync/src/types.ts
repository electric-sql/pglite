import type {
  ShapeStreamOptions,
  ShapeStreamInterface,
  Row,
  ChangeMessage,
} from '@electric-sql/client'

export type MapColumnsMap = Record<string, string>
export type MapColumnsFn = (message: ChangeMessage<any>) => Record<string, any>
export type MapColumns = MapColumnsMap | MapColumnsFn
export type SubscriptionKey = string

export interface ShapeToTableOptions {
  shape: ShapeStreamOptions
  table: string
  schema?: string
  mapColumns?: MapColumns
  primaryKey: string[]
}

export interface SyncShapesToTablesOptions {
  key: string | null
  shapes: Record<string, ShapeToTableOptions>
  useCopy?: boolean
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
  useCopy?: boolean
  onInitialSync?: () => void
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
