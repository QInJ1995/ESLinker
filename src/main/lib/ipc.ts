import { ipcMain } from 'electron'
import { appStore } from './store'
import { testDbConnection, readTree, readTableMeta } from './metadata'
import {
  testEsConnection,
  esIndexExists,
  esCreateIndex,
  esUpdateMapping,
  esDeleteIndex,
  exportMappingJson
} from './es'
import {
  generateMappingFields,
  buildMappingDocument,
  parseDDL,
  ruleOptionsFromSettings,
  validateMapping
} from './mapping'
import { syncManager } from './sync/manager'
import {
  DataSourceItem,
  DbConfig,
  EsConfig,
  MappingTemplate,
  Settings,
  SyncTask,
  TableMeta
} from './types'

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function registerIpc(): void {
  // ---------- Datasources ----------
  ipcMain.handle('datasource:list', () => appStore.listDatasources())

  ipcMain.handle('datasource:save', (_e, item: DataSourceItem) => {
    appStore.saveDatasource(item)
    return true
  })

  ipcMain.handle('datasource:delete', (_e, kind: 'db' | 'es', id: string) => {
    appStore.deleteDatasource(kind, id)
    return true
  })

  ipcMain.handle('datasource:test', async (_e, item: DataSourceItem) => {
    if (item.kind === 'db' && item.db) {
      const cfg = { ...item.db }
      // keep stored credential if the input carries a masked placeholder
      const stored = appStore.getDbConfig(cfg.id)
      if ((!cfg.password || cfg.password === '__MASKED__') && stored) cfg.password = stored.password
      await testDbConnection(cfg)
      return { kind: 'db', ok: true }
    }
    if (item.kind === 'es' && item.es) {
      const cfg: EsConfig = { ...item.es }
      const stored = appStore.getEsConfig(cfg.id)
      if ((!cfg.password || cfg.password === '__MASKED__') && stored) cfg.password = stored.password
      const info = await testEsConnection(cfg)
      return { kind: 'es', ok: true, ...info }
    }
    throw new Error('Invalid datasource payload')
  })

  ipcMain.handle('datasource:tree', async (_e, cfg: DbConfig) => {
    const stored = appStore.getDbConfig(cfg.id)
    if ((!cfg.password || cfg.password === '__MASKED__') && stored) cfg.password = stored.password
    return readTree(cfg)
  })

  ipcMain.handle(
    'datasource:structure',
    async (_e, cfg: DbConfig, database: string, table: string): Promise<TableMeta> => {
      const stored = appStore.getDbConfig(cfg.id)
      if ((!cfg.password || cfg.password === '__MASKED__') && stored) cfg.password = stored.password
      return readTableMeta(cfg, database, table)
    }
  )

  // ---------- Mapping ----------
  ipcMain.handle('mapping:generate', (_e, meta: TableMeta, settings: Settings) => {
    return generateMappingFields(meta, ruleOptionsFromSettings(settings))
  })

  ipcMain.handle('mapping:document', (_e, fields: unknown[], settings: Settings) => {
    return buildMappingDocument(fields as never[], settings)
  })

  ipcMain.handle('mapping:parseDDL', (_e, ddl: string) => parseDDL(ddl))

  ipcMain.handle('mapping:validate', (_e, fields: unknown[]) => validateMapping(fields as never[]))

  // ---------- Templates ----------
  ipcMain.handle('templates:list', () => appStore.listTemplates())

  ipcMain.handle('templates:save', (_e, tpl: MappingTemplate) => {
    appStore.saveTemplate(tpl)
    return true
  })

  ipcMain.handle('templates:delete', (_e, id: string) => {
    appStore.deleteTemplate(id)
    return true
  })

  // ---------- ES ----------
  ipcMain.handle('es:test', async (_e, cfg: EsConfig) => {
    const stored = appStore.getEsConfig(cfg.id)
    if ((!cfg.password || cfg.password === '__MASKED__') && stored) cfg.password = stored.password
    return testEsConnection(cfg)
  })

  ipcMain.handle('es:exists', async (_e, cfg: EsConfig, index: string) => {
    const stored = appStore.getEsConfig(cfg.id)
    if ((!cfg.password || cfg.password === '__MASKED__') && stored) cfg.password = stored.password
    return esIndexExists(cfg, index)
  })

  ipcMain.handle(
    'es:create',
    async (_e, cfg: EsConfig, index: string, doc: unknown, overwrite: boolean) => {
      const stored = appStore.getEsConfig(cfg.id)
      if ((!cfg.password || cfg.password === '__MASKED__') && stored) cfg.password = stored.password
      return esCreateIndex(cfg, index, doc as never, { overwrite })
    }
  )

  ipcMain.handle('es:update', async (_e, cfg: EsConfig, index: string, properties: unknown) => {
    const stored = appStore.getEsConfig(cfg.id)
    if ((!cfg.password || cfg.password === '__MASKED__') && stored) cfg.password = stored.password
    await esUpdateMapping(cfg, index, properties as Record<string, unknown>)
    return true
  })

  ipcMain.handle('es:delete', async (_e, cfg: EsConfig, index: string) => {
    const stored = appStore.getEsConfig(cfg.id)
    if ((!cfg.password || cfg.password === '__MASKED__') && stored) cfg.password = stored.password
    await esDeleteIndex(cfg, index)
    return true
  })

  ipcMain.handle('es:export', async (_e, doc: unknown, fileName: string) => {
    return exportMappingJson(doc as never, fileName)
  })

  // ---------- Sync ----------
  ipcMain.handle('sync:list', () => appStore.listTasks())

  ipcMain.handle('sync:save', (_e, task: SyncTask) => {
    appStore.saveTask(task)
    return true
  })

  ipcMain.handle('sync:delete', (_e, id: string) => {
    if (syncManager.isRunning(id)) throw new Error('Stop the task before deleting it')
    appStore.deleteTask(id)
    return true
  })

  ipcMain.handle('sync:start', async (_e, id: string) => {
    await syncManager.start(id)
    return true
  })
  ipcMain.handle('sync:pause', (_e, id: string) => {
    syncManager.pause(id)
    return true
  })
  ipcMain.handle('sync:resume', async (_e, id: string) => {
    await syncManager.resume(id)
    return true
  })
  ipcMain.handle('sync:stop', async (_e, id: string) => {
    await syncManager.stop(id)
    return true
  })
  ipcMain.handle('sync:restart', async (_e, id: string) => {
    await syncManager.restart(id)
    return true
  })

  // ---------- Settings & logs ----------
  ipcMain.handle('settings:get', () => appStore.getSettings())

  ipcMain.handle('settings:set', (_e, settings: Settings) => {
    appStore.setSettings(settings)
    return true
  })

  ipcMain.handle('log:read', (_e, taskId: string) => appStore.readLog(taskId))
  ipcMain.handle('log:export', () => appStore.exportLogs())
}

export { uuid }
