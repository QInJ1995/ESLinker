import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  DataSourceItem,
  DbConfig,
  EsConfig,
  MappingField,
  MappingIssue,
  MappingTemplate,
  Settings,
  SyncEventPayload,
  SyncTask,
  TableMeta
} from '../main/lib/types'

export interface EsLinkerApi {
  datasource: {
    list: () => Promise<DataSourceItem[]>
    save: (item: DataSourceItem) => Promise<boolean>
    remove: (kind: 'db' | 'es', id: string) => Promise<boolean>
    test: (item: DataSourceItem) => Promise<{ ok: boolean; kind?: string; version?: string }>
    tree: (cfg: DbConfig) => Promise<{
      databases: string[]
      trees: Array<{ database: string; tables: Array<{ name: string; comment?: string | null }> }>
    }>
    structure: (cfg: DbConfig, database: string, table: string) => Promise<TableMeta>
  }
  mapping: {
    generate: (meta: TableMeta, settings: Settings) => Promise<MappingField[]>
    document: (fields: MappingField[], settings: Settings) => Promise<unknown>
    parseDDL: (ddl: string) => Promise<TableMeta | null>
    validate: (fields: MappingField[]) => Promise<MappingIssue[]>
  }
  templates: {
    list: () => Promise<MappingTemplate[]>
    save: (tpl: MappingTemplate) => Promise<boolean>
    remove: (id: string) => Promise<boolean>
  }
  es: {
    test: (cfg: EsConfig) => Promise<{ version: string; cluster: string }>
    exists: (cfg: EsConfig, index: string) => Promise<boolean>
    create: (cfg: EsConfig, index: string, doc: unknown, overwrite: boolean) => Promise<unknown>
    update: (cfg: EsConfig, index: string, properties: unknown) => Promise<boolean>
    remove: (cfg: EsConfig, index: string) => Promise<boolean>
    export: (doc: unknown, fileName: string) => Promise<string | null>
  }
  sync: {
    list: () => Promise<SyncTask[]>
    save: (task: SyncTask) => Promise<boolean>
    remove: (id: string) => Promise<boolean>
    start: (id: string) => Promise<boolean>
    pause: (id: string) => Promise<boolean>
    resume: (id: string) => Promise<boolean>
    stop: (id: string) => Promise<boolean>
    restart: (id: string) => Promise<boolean>
    onEvent: (cb: (payload: SyncEventPayload) => void) => () => void
  }
  settings: {
    get: () => Promise<Settings>
    set: (s: Settings) => Promise<boolean>
  }
  log: {
    read: (taskId: string) => Promise<string>
    export: () => Promise<{ dir: string; files: string[] }>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: EsLinkerApi
  }
}
