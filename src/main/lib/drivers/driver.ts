import { TableMeta } from '../types'

export interface DBDriver {
  readonly type: string
  testConnection(): Promise<void>
  listDatabases(): Promise<string[]>
  listTables(database: string): Promise<Array<{ name: string; comment?: string | null }>>
  getTableMeta(database: string, table: string): Promise<TableMeta>
  countRows(database: string, table: string): Promise<number>
  /** Keyset pagination page of rows after the given PK value */
  queryPage(
    database: string,
    table: string,
    primaryKey: string,
    lastId: string | number | null,
    pageSize: number
  ): Promise<Array<Record<string, unknown>>>
  close(): Promise<void>
}

export function qt(identifier: string): string {
  return `\`${identifier.replace(/`/g, '``')}\``
}

export function normType(raw: string): string {
  return raw.toLowerCase().replace(/\(.*/, '').trim()
}
