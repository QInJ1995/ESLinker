import Store from 'electron-store'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, readdirSync } from 'fs'
import {
  DataSourceItem,
  DbConfig,
  EsConfig,
  MappingTemplate,
  Settings,
  SyncTask,
  DEFAULT_SETTINGS
} from './types'
import { encrypt, decrypt } from './crypto'

interface DataShape {
  datasources?: Array<{ id: string; name: string; kind: string; content: string }>
  templates?: MappingTemplate[]
  tasks?: SyncTask[]
  settings?: Settings
}

class AppStore {
  private store: Store<DataShape>
  private logDir: string

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.store = new Store<DataShape>({ name: 'eslinker-data', defaults: {} } as any)
    this.logDir = join(app.getPath('userData'), 'logs')
    mkdirSync(this.logDir, { recursive: true })
  }

  // ---------- Datasources (encrypted) ----------

  listDatasources(): DataSourceItem[] {
    const raw = this.store.get('datasources') || []
    return raw.map((item) => {
      const itemStr = decrypt(item.content)
      if (!itemStr) return { kind: item.kind === 'es' ? 'es' : 'db' } as DataSourceItem
      try {
        const parsed = JSON.parse(itemStr) as DbConfig | EsConfig
        if (item.kind === 'es') {
          return { kind: 'es', es: parsed as EsConfig }
        }
        return { kind: 'db', db: parsed as DbConfig }
      } catch {
        return { kind: item.kind === 'es' ? 'es' : 'db' } as DataSourceItem
      }
    })
  }

  getDbConfig(id: string): DbConfig | undefined {
    return this.listDatasources().find((i) => i.kind === 'db' && i.db?.id === id)?.db
  }

  getEsConfig(id: string): EsConfig | undefined {
    return this.listDatasources().find((i) => i.kind === 'es' && i.es?.id === id)?.es
  }

  saveDatasource(item: DataSourceItem): void {
    const items = this.listDatasources()
    if (item.kind === 'db' && item.db) {
      const existing = items.find((i) => i.kind === 'db' && i.db?.id === item.db?.id)
      if (existing?.db) {
        // keep existing password when a new one wasn't provided
        if (!item.db.password) {
          item.db.password = existing.db.password
        }
        const idx = items.indexOf(existing)
        items[idx] = item
      } else {
        items.push(item)
      }
    } else if (item.kind === 'es' && item.es) {
      const existing = items.find((i) => i.kind === 'es' && i.es?.id === item.es?.id)
      if (existing?.es) {
        if (!item.es.password) {
          item.es.password = existing.es.password
        }
        const idx = items.indexOf(existing)
        items[idx] = item
      } else {
        items.push(item)
      }
    }
    this.writeDatasources(items)
  }

  deleteDatasource(kind: 'db' | 'es', id: string): void {
    const items = this.listDatasources().filter(
      (i) => !(i.kind === kind && (kind === 'db' ? i.db?.id : i.es?.id) === id)
    )
    this.writeDatasources(items)
  }

  private writeDatasources(items: DataSourceItem[]): void {
    const raw = items
      .map((i) => {
        const content =
          i.kind === 'db' ? (i.db ? JSON.stringify(i.db) : '') : i.es ? JSON.stringify(i.es) : ''
        if (!content) return null
        return {
          id: i.db?.id || i.es?.id || '',
          name: i.db?.name || i.es?.name || '',
          kind: i.kind,
          content: encrypt(content)
        }
      })
      .filter(Boolean) as Array<{ id: string; name: string; kind: string; content: string }>
    this.store.set('datasources', raw)
  }

  // ---------- Mapping templates ----------

  listTemplates(): MappingTemplate[] {
    return this.store.get('templates') || []
  }

  saveTemplate(template: MappingTemplate): void {
    const templates = this.listTemplates()
    const idx = templates.findIndex((t) => t.id === template.id)
    if (idx >= 0) templates[idx] = template
    else templates.push(template)
    this.store.set('templates', templates)
  }

  deleteTemplate(id: string): void {
    this.store.set(
      'templates',
      (this.store.get('templates') || []).filter((t) => t.id !== id)
    )
  }

  // ---------- Sync tasks ----------

  listTasks(): SyncTask[] {
    const tasks = this.store.get('tasks') || []
    return tasks
  }

  saveTask(task: SyncTask): void {
    const tasks = this.store.get('tasks') || []
    const idx = tasks.findIndex((t) => t.id === task.id)
    if (idx >= 0) tasks[idx] = task
    else tasks.push(task)
    this.store.set('tasks', tasks)
  }

  deleteTask(id: string): void {
    this.store.set(
      'tasks',
      (this.store.get('tasks') || []).filter((t) => t.id !== id)
    )
  }

  setTaskStats(id: string, stats: SyncTask['stats']): void {
    const tasks = this.store.get('tasks') || []
    const task = tasks.find((t) => t.id === id)
    if (task) {
      task.stats = stats
      this.store.set('tasks', tasks)
    }
  }

  // ---------- Settings ----------

  getSettings(): Settings {
    return { ...DEFAULT_SETTINGS, ...(this.store.get('settings') || {}) }
  }

  setSettings(settings: Settings): void {
    this.store.set('settings', { ...this.getSettings(), ...settings })
  }

  // ---------- Log files ----------

  writeLog(taskId: string, line: string): void {
    try {
      const file = join(this.logDir, `${taskId}.log`)
      const ts = new Date().toISOString()
      appendFileSync(file, `[${ts}] ${line}\n`, 'utf8')
    } catch {
      // ignore log write failures
    }
  }

  readLog(taskId: string): string {
    try {
      const file = join(this.logDir, `${taskId}.log`)
      return readFileSync(file, 'utf8')
    } catch {
      return ''
    }
  }

  exportLogs(): { dir: string; files: string[] } {
    return { dir: this.logDir, files: readdirSync(this.logDir) }
  }

  writeExport(data: string, fileName: string): string {
    const file = join(this.logDir, fileName)
    writeFileSync(file, data, 'utf8')
    return file
  }
}

export const appStore = new AppStore()
export type { DataShape }
