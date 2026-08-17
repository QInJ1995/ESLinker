import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
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
import type { EsLinkerApi as Api } from './index.d'

function cloneForIpc<T>(value: T): T {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  return JSON.parse(JSON.stringify(value)) as T
}

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const cloned = args.map((a) => cloneForIpc(a))
  return ipcRenderer.invoke(channel, ...cloned)
}

const api: Api = {
  datasource: {
    list: (): Promise<DataSourceItem[]> => invoke('datasource:list') as Promise<DataSourceItem[]>,
    save: (item: DataSourceItem): Promise<boolean> => invoke('datasource:save', item) as Promise<boolean>,
    remove: (kind: 'db' | 'es', id: string): Promise<boolean> =>
      invoke('datasource:delete', kind, id) as Promise<boolean>,
    test: (item: DataSourceItem): Promise<{ ok: boolean; kind?: string; version?: string }> =>
      invoke('datasource:test', item) as Promise<{ ok: boolean; kind?: string; version?: string }>,
    tree: (
      cfg: DbConfig
    ): Promise<{
      databases: string[]
      trees: Array<{ database: string; tables: Array<{ name: string; comment?: string | null }> }>
    }> => invoke('datasource:tree', cfg) as Promise<{
      databases: string[]
      trees: Array<{ database: string; tables: Array<{ name: string; comment?: string | null }> }>
    }>,
    structure: (cfg: DbConfig, database: string, table: string): Promise<TableMeta> =>
      invoke('datasource:structure', cfg, database, table) as Promise<TableMeta>
  },
  mapping: {
    generate: (meta: TableMeta, settings: Settings): Promise<MappingField[]> =>
      invoke('mapping:generate', meta, settings) as Promise<MappingField[]>,
    document: (fields: MappingField[], settings: Settings): Promise<unknown> =>
      invoke('mapping:document', fields, settings),
    parseDDL: (ddl: string): Promise<TableMeta | null> =>
      invoke('mapping:parseDDL', ddl) as Promise<TableMeta | null>,
    validate: (fields: MappingField[]): Promise<MappingIssue[]> =>
      invoke('mapping:validate', fields) as Promise<MappingIssue[]>
  },
  templates: {
    list: (): Promise<MappingTemplate[]> => invoke('templates:list') as Promise<MappingTemplate[]>,
    save: (tpl: MappingTemplate): Promise<boolean> => invoke('templates:save', tpl) as Promise<boolean>,
    remove: (id: string): Promise<boolean> => invoke('templates:delete', id) as Promise<boolean>
  },
  es: {
    test: (cfg: EsConfig): Promise<{ version: string; cluster: string }> =>
      invoke('es:test', cfg) as Promise<{ version: string; cluster: string }>,
    exists: (cfg: EsConfig, index: string): Promise<boolean> =>
      invoke('es:exists', cfg, index) as Promise<boolean>,
    create: (cfg: EsConfig, index: string, doc: unknown, overwrite: boolean): Promise<unknown> =>
      invoke('es:create', cfg, index, doc, overwrite),
    update: (cfg: EsConfig, index: string, properties: unknown): Promise<boolean> =>
      invoke('es:update', cfg, index, properties) as Promise<boolean>,
    remove: (cfg: EsConfig, index: string): Promise<boolean> =>
      invoke('es:delete', cfg, index) as Promise<boolean>,
    export: (doc: unknown, fileName: string): Promise<string | null> =>
      invoke('es:export', doc, fileName) as Promise<string | null>
  },
  sync: {
    list: (): Promise<SyncTask[]> => invoke('sync:list') as Promise<SyncTask[]>,
    save: (task: SyncTask): Promise<boolean> => invoke('sync:save', task) as Promise<boolean>,
    remove: (id: string): Promise<boolean> => invoke('sync:delete', id) as Promise<boolean>,
    start: (id: string): Promise<boolean> => invoke('sync:start', id) as Promise<boolean>,
    pause: (id: string): Promise<boolean> => invoke('sync:pause', id) as Promise<boolean>,
    resume: (id: string): Promise<boolean> => invoke('sync:resume', id) as Promise<boolean>,
    stop: (id: string): Promise<boolean> => invoke('sync:stop', id) as Promise<boolean>,
    restart: (id: string): Promise<boolean> => invoke('sync:restart', id) as Promise<boolean>,
    onEvent: (cb: (payload: SyncEventPayload) => void): (() => void) => {
      const listener = (_e: unknown, payload: SyncEventPayload): void => cb(payload)
      ipcRenderer.on('sync:event', listener)
      return () => ipcRenderer.removeListener('sync:event', listener)
    }
  },
  settings: {
    get: (): Promise<Settings> => invoke('settings:get') as Promise<Settings>,
    set: (s: Settings): Promise<boolean> => invoke('settings:set', s) as Promise<boolean>
  },
  log: {
    read: (taskId: string): Promise<string> => invoke('log:read', taskId) as Promise<string>,
    export: (): Promise<{ dir: string; files: string[] }> => invoke('log:export') as Promise<{ dir: string; files: string[] }>
  }
}

export type EsLinkerApi = Api

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
