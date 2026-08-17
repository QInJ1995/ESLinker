import MySQLEvents from 'mysql-events'
import { SyncTask } from '../types'
import { DbConfig, EsConfig } from '../types'
import { esBulkWrite } from '../es'
import { appStore } from '../store'
import { broadcast } from '../broadcast'
import { SyncGate } from './full'

interface BinlogRow {
  fields: Record<string, unknown>
}

interface ZongjiLike {
  binlogName?: string
  binlogNextPos?: number
  stop?: () => void
  on: (event: string, cb: (...args: never[]) => void) => void
}

/**
 * Incremental sync: connect to the MySQL binlog stream locally (no external
 * Canal deployment) and mirror INSERT/UPDATE/DELETE into ES in near real time.
 */
export async function startIncremental(
  task: SyncTask,
  dbConfig: DbConfig,
  esConfig: EsConfig,
  signal: AbortSignal,
  gate: SyncGate
): Promise<void> {
  task.status = 'running'
  task.phase = 'incremental'
  task.binlog.started = true
  appStore.saveTask(task)
  broadcast('sync:event', {
    taskId: task.id,
    type: 'status',
    status: task.status,
    phase: task.phase,
    message: 'Incremental binlog listener starting'
  })

  const settings: Record<string, unknown> = {
    startAtEnd: false,
    includeSchema: { [task.database]: [task.table] },
    includeEvents: ['tablemap', 'writerows', 'updaterows', 'deleterows']
  }
  if (task.binlog.binlogName && task.binlog.binlogPos) {
    settings['binlogName'] = task.binlog.binlogName
    settings['binlogNextPos'] = task.binlog.binlogPos
  }

  const instance = new MySQLEvents(
    {
      host: dbConfig.host,
      port: dbConfig.port || 3306,
      user: dbConfig.username,
      password: dbConfig.password
    },
    settings
  )

  const zongji = () => (instance as unknown as { zongji: ZongjiLike }).zongji as ZongjiLike

  // wire lifecycle listeners after the internal zongji instance is created
  const attachListeners = (): void => {
    const z = zongji()
    z.on('error', (err: never) => {
      const message = (err as Error).message
      task.stats.lastError = message
      broadcast('sync:event', {
        taskId: task.id,
        type: 'error',
        status: task.status,
        phase: task.phase,
        message: `Binlog error: ${message}`,
        stats: { ...task.stats }
      })
    })
    z.on('connected', (() => {
      broadcast('sync:event', {
        taskId: task.id,
        type: 'status',
        status: task.status,
        phase: task.phase,
        message: 'Binlog connected, streaming changes live'
      })
    }) as never)
  }

  instance.add(
    `${task.database}.${task.table}`,
    async (oldRow: BinlogRow | null, newRow: BinlogRow | null) => {
      if (signal.aborted || gate.aborted) return
      await gate.checkPause()
      let action: 'upsert' | 'delete'
      let doc: Record<string, unknown> | null = null
      if (newRow === null && oldRow) {
        action = 'delete'
        doc = oldRow.fields
      } else if (newRow) {
        action = 'upsert'
        doc = newRow.fields
      } else {
        return
      }
      if (!doc || doc[task.primaryKey] === undefined || doc[task.primaryKey] === null) return

      const res = await esBulkWrite(esConfig, task.esIndex, [doc], task.primaryKey, { action })
      if (action === 'delete') task.stats.deleted += res.ok
      else task.stats.updated += res.ok
      task.stats.failed += res.failed
      task.stats.latencyMs = Date.now()
      appStore.saveTask(task)
      broadcast('sync:event', {
        taskId: task.id,
        type: 'progress',
        status: task.status,
        phase: task.phase,
        stats: { ...task.stats }
      })
    }
  )

  attachListeners()
  appStore.writeLog(task.id, `Incremental listener attached to ${task.database}.${task.table}`)

  // keep the listener alive until the task is stopped/paused
  while (!signal.aborted && !gate.aborted) {
    await new Promise((r) => setTimeout(r, 500))
    await gate.checkPause()
  }

  // capture position for resume before stopping
  const z = zongji()
  if (z.binlogName) task.binlog.binlogName = z.binlogName
  if (typeof z.binlogNextPos === 'number') task.binlog.binlogPos = z.binlogNextPos
  z.stop?.()
  appStore.saveTask(task)
}
