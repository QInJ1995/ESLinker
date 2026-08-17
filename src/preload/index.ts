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

const api: Api = {
  datasource: {
    list: (): Promise<DataSourceItem[]> => ipcRenderer.invoke('datasource:list'),
    save: (item: DataSourceItem): Promise<boolean> => ipcRenderer.invoke('datasource:save', item),
    remove: (kind: 'db' | 'es', id: string): Promise<boolean> =>
      ipcRenderer.invoke('datasource:delete', kind, id),
    test: (item: DataSourceItem): Promise<{ ok: boolean; kind?: string; version?: string }> =>
      ipcRenderer.invoke('datasource:test', item),
    tree: (
      cfg: DbConfig
    ): Promise<{
      databases: string[]
      trees: Array<{ database: string; tables: Array<{ name: string; comment?: string | null }> }>
    }> => ipcRenderer.invoke('datasource:tree', cfg),
    structure: (cfg: DbConfig, database: string, table: string): Promise<TableMeta> =>
      ipcRenderer.invoke('datasource:structure', cfg, database, table)
  },
  mapping: {
    generate: (meta: TableMeta, settings: Settings): Promise<MappingField[]> =>
      ipcRenderer.invoke('mapping:generate', meta, settings),
    document: (fields: MappingField[], settings: Settings): Promise<unknown> =>
      ipcRenderer.invoke('mapping:document', fields, settings),
    parseDDL: (ddl: string): Promise<TableMeta | null> =>
      ipcRenderer.invoke('mapping:parseDDL', ddl),
    validate: (fields: MappingField[]): Promise<MappingIssue[]> =>
      ipcRenderer.invoke('mapping:validate', fields)
  },
  templates: {
    list: (): Promise<MappingTemplate[]> => ipcRenderer.invoke('templates:list'),
    save: (tpl: MappingTemplate): Promise<boolean> => ipcRenderer.invoke('templates:save', tpl),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke('templates:delete', id)
  },
  es: {
    test: (cfg: EsConfig): Promise<{ version: string; cluster: string }> =>
      ipcRenderer.invoke('es:test', cfg),
    exists: (cfg: EsConfig, index: string): Promise<boolean> =>
      ipcRenderer.invoke('es:exists', cfg, index),
    create: (cfg: EsConfig, index: string, doc: unknown, overwrite: boolean): Promise<unknown> =>
      ipcRenderer.invoke('es:create', cfg, index, doc, overwrite),
    update: (cfg: EsConfig, index: string, properties: unknown): Promise<boolean> =>
      ipcRenderer.invoke('es:update', cfg, index, properties),
    remove: (cfg: EsConfig, index: string): Promise<boolean> =>
      ipcRenderer.invoke('es:delete', cfg, index),
    export: (doc: unknown, fileName: string): Promise<string | null> =>
      ipcRenderer.invoke('es:export', doc, fileName)
  },
  sync: {
    list: (): Promise<SyncTask[]> => ipcRenderer.invoke('sync:list'),
    save: (task: SyncTask): Promise<boolean> => ipcRenderer.invoke('sync:save', task),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke('sync:delete', id),
    start: (id: string): Promise<boolean> => ipcRenderer.invoke('sync:start', id),
    pause: (id: string): Promise<boolean> => ipcRenderer.invoke('sync:pause', id),
    resume: (id: string): Promise<boolean> => ipcRenderer.invoke('sync:resume', id),
    stop: (id: string): Promise<boolean> => ipcRenderer.invoke('sync:stop', id),
    restart: (id: string): Promise<boolean> => ipcRenderer.invoke('sync:restart', id),
    onEvent: (cb: (payload: SyncEventPayload) => void): (() => void) => {
      const listener = (_e: unknown, payload: SyncEventPayload): void => cb(payload)
      ipcRenderer.on('sync:event', listener)
      return () => ipcRenderer.removeListener('sync:event', listener)
    }
  },
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    set: (s: Settings): Promise<boolean> => ipcRenderer.invoke('settings:set', s)
  },
  log: {
    read: (taskId: string): Promise<string> => ipcRenderer.invoke('log:read', taskId),
    export: (): Promise<{ dir: string; files: string[] }> => ipcRenderer.invoke('log:export')
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
