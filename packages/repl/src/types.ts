import { type Results as BaseResults } from '@electric-sql/pglite'

export type Results = BaseResults<{ [key: string]: unknown }[]>

export interface Response {
  query: string
  text?: string
  error?: string
  results?: Results[]
  time: number
}
