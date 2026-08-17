import { toRaw } from 'vue'

export type {
  DataSourceItem,
  DbConfig,
  EsConfig,
  ColumnMeta,
  TableMeta,
  MappingField,
  MappingDocument,
  MappingTemplate,
  SyncTask,
  SyncEventPayload,
  Settings,
  DbType,
  EsVersion,
  SyncMode,
  SyncStatus,
  SyncPhase,
  CompareRequest,
  CompareResult
} from '../../../main/lib/types'

import type { Settings } from '../../../main/lib/types'

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

export const DB_TYPE_LABELS = [
  { value: 'mysql', label: 'MySQL' },
  { value: 'postgres', label: 'PostgreSQL' },
  { value: 'mssql', label: 'SQL Server' }
]

export const ES_TYPE_OPTIONS = [
  'text',
  'keyword',
  'long',
  'integer',
  'float',
  'double',
  'scaled_float',
  'boolean',
  'date',
  'geo_point',
  'object'
]

export const ANALYZER_OPTIONS = ['standard', 'keyword', 'ik_max_word', 'ik_smart', 'whitespace']

export const DATE_FORMAT_OPTIONS = [
  'yyyy-MM-dd HH:mm:ss||yyyy-MM-dd||epoch_millis||strict_date_optional_time',
  'yyyy-MM-dd||epoch_millis',
  'strict_date_optional_time||epoch_millis'
]

export function uid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function serialize<T>(value: T): T {
  if (value === null || value === undefined) return value
  return JSON.parse(JSON.stringify(toRaw(value))) as T
}
