import { DatabaseError } from '@electric-sql/pg-protocol/messages'
import { QueryOptions } from './interface'

export interface PGliteError extends DatabaseError {
  query: string | undefined
  params: any[] | undefined
  queryOptions: QueryOptions | undefined
}

export function makePGliteError(data: {
  e: DatabaseError
  query: string
  params: any[] | undefined
  options: QueryOptions | undefined
}) {
  const pgError = data.e as PGliteError
  pgError.query = data.query
  pgError.params = data.params
  pgError.queryOptions = data.options
  return pgError
}
