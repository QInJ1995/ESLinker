export type DbType = 'mysql' | 'postgres' | 'mssql'
export type SourceKind = 'db' | 'es'
export type EsVersion = '7' | '8'
export type SyncMode = 'full' | 'incremental' | 'full_then_incremental'
export type SyncStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'error' | 'finished'
export type SyncPhase = 'idle' | 'full' | 'incremental' | 'done'

export interface DbConfig {
  id: string
  name: string
  type: DbType
  host: string
  port: number
  username: string
  password: string
  database?: string
  useSsl?: boolean
}

export interface EsConfig {
  id: string
  name: string
  secure: boolean
  host: string
  port: number
  username: string
  password: string
  apiKey?: string
  version: EsVersion
}

export interface DataSourceItem {
  kind: SourceKind
  db?: DbConfig
  es?: EsConfig
}

export interface ColumnMeta {
  name: string
  rawType: string
  dataType: string
  length: number | null
  precision: number | null
  scale: number | null
  nullable: boolean
  primaryKey: boolean
  autoIncrement: boolean
  default: string | null
  comment: string | null
}

export interface TableMeta {
  database: string
  table: string
  comment: string | null
  engine: string | null
  columns: ColumnMeta[]
  primaryKey: string | null
  rowCount?: number
}

export interface DbTreeNode {
  name: string
  children?: DbTreeNode[]
}

export interface MappingField {
  column: string
  field: string
  esType: string
  addKeyword: boolean
  indexable: boolean
  analyzed: boolean
  analyzer?: string
  ignoreAbove?: number
  scalingFactor?: number
  format?: string
  comment?: string
}

export interface MappingRuleOptions {
  keywordSubField: boolean
  ignoreAbove: number
  analyzer: string
  analyzeAllStrings: boolean
  scaledFloatAsMoney: boolean
}

export interface MappingDocument {
  settings: {
    number_of_shards: number
    number_of_replicas: number
  }
  mappings: {
    properties: Record<string, unknown>
  }
}

export interface SyncTask {
  id: string
  name: string
  dbSourceId: string
  database: string
  table: string
  esSourceId: string
  esIndex: string
  primaryKey: string
  batchSize: number
  concurrency: number
  mode: SyncMode
  mapping?: MappingDocument
  status: SyncStatus
  phase: SyncPhase
  cursor: { lastId: string | number | null }
  binlog: { started: boolean; binlogName?: string; binlogPos?: number; lastEvent?: string }
  stats: {
    inserted: number
    updated: number
    deleted: number
    failed: number
    processed: number
    total: number
    startedAt: string | null
    endedAt: string | null
    latencyMs: number
    lastError: string | null
  }
  createdAt: string
}

export interface SyncEventPayload {
  taskId: string
  type: 'status' | 'progress' | 'error' | 'log'
  status?: SyncStatus
  phase?: SyncPhase
  message?: string
  stats?: SyncTask['stats']
}

export interface MappingIssue {
  field: string
  level: 'error' | 'warning'
  message: string
}

export interface MappingTemplate {
  id: string
  name: string
  createdAt: string
  fields: MappingField[]
}

export interface Settings {
  defaultShards: number
  defaultReplicas: number
  autoKeywordSubField: boolean
  ignoreAbove: number
  analyzer: string
  analyzeAllStrings: boolean
  scaledFloatAsMoney: boolean
  retryCount: number
}

export const DEFAULT_SETTINGS: Settings = {
  defaultShards: 1,
  defaultReplicas: 0,
  autoKeywordSubField: true,
  ignoreAbove: 256,
  analyzer: 'standard',
  analyzeAllStrings: false,
  scaledFloatAsMoney: true,
  retryCount: 3
}

export interface QueryResult {
  rows: Array<Record<string, unknown>>
  total: number
}

export interface SyncCountResult {
  total: number
}
