import { appStore } from '../store'
import { SyncTask } from '../types'
import { createDriver } from '../metadata'
import { buildClient, esBulkWrite } from '../es'
import { broadcast } from '../broadcast'
import { DbConfig, EsConfig } from '../types'

export interface SyncGate {
  aborted: boolean
  paused: boolean
  checkPause(): Promise<void>
  checkAbort(): void
}

export function createGate(signal: AbortSignal): SyncGate {
  const gate: SyncGate = {
    aborted: false,
    paused: false,
    checkPause: async () => {
      while (gate.paused && !gate.aborted && !signal.aborted) {
        await new Promise((r) => setTimeout(r, 200))
      }
    },
    checkAbort: () => {
      if (gate.aborted || signal.aborted) throw new Error('SYNC_ABORTED')
    }
  }
  return gate
}

function persistAndBroadcast(task: SyncTask, message?: string): void {
  appStore.saveTask(task)
  broadcast('sync:event', {
    taskId: task.id,
    type: 'progress',
    status: task.status,
    phase: task.phase,
    message,
    stats: { ...task.stats }
  })
}

/**
 * Full (baseline) sync: keyset pagination over the primary key, batched bulk
 * writes into ES with a persisted checkpoint for crash/resume support.
 */
export async function runFullPhase(
  task: SyncTask,
  dbConfig: DbConfig,
  esConfig: EsConfig,
  gate: SyncGate
): Promise<void> {
  const driver = createDriver(dbConfig)
  const client = buildClient(esConfig)
  const pk = task.primaryKey
  let lastId: string | number | null = task.cursor.lastId
  let processed = task.stats.processed

  task.status = 'running'
  task.phase = 'full'
  persistAndBroadcast(task, `Full sync started, total estimated: ${task.stats.total}`)

  try {
    const total = await driver.countRows(task.database, task.table)
    task.stats.total = total
    persistAndBroadcast(task, `Table row count: ${total}`)

    // eslint-disable-next-line no-constant-condition
    while (true) {
      gate.checkAbort()
      await gate.checkPause()
      const rows = await driver.queryPage(task.database, task.table, pk, lastId, task.batchSize)
      if (rows.length === 0) break

      const hasClient = await client.ping().catch(() => false)
      if (!hasClient) throw new Error('ES connection lost')
      const res = await esBulkWrite(esConfig, task.esIndex, rows, pk, { action: 'upsert' })
      processed += res.ok
      task.stats.processed = processed
      task.stats.inserted += res.ok
      task.stats.failed += res.failed
      if (res.error) task.stats.lastError = res.error
      const lastRow = rows[rows.length - 1]
      lastId = (lastRow as Record<string, unknown>)[pk] as string | number
      task.cursor.lastId = lastId
      persistAndBroadcast(task, `Bulk ${rows.length} rows (${res.ok} ok / ${res.failed} failed)`)

      if (rows.length < task.batchSize) break
    }

    task.stats.endedAt = new Date().toISOString()
    task.cursor.lastId = null
    task.stats.processed = processed
    persistAndBroadcast(task, 'Full sync completed')
  } finally {
    await driver.close()
    client.close()
  }
}
