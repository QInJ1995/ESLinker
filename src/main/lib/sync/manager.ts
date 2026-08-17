import { appStore } from '../store'
import { SyncTask } from '../types'
import { createGate, runFullPhase, SyncGate } from './full'
import { startIncremental } from './binlog'
import { broadcast } from '../broadcast'
import { DbConfig, EsConfig } from '../types'
import { BrowserWindow, dialog } from 'electron'

interface Runtime {
  controller: AbortController
  gate: SyncGate
}

class SyncManager {
  private runners = new Map<string, Runtime>()

  isRunning(taskId: string): boolean {
    return this.runners.has(taskId)
  }

  listRunning(): string[] {
    return [...this.runners.keys()]
  }

  async start(taskId: string): Promise<void> {
    const task = appStore.listTasks().find((t) => t.id === taskId)
    if (!task) throw new Error('Task not found')
    if (this.runners.has(taskId)) throw new Error('Task is already running')

    const controller = new AbortController()
    const gate = createGate(controller.signal)
    this.runners.set(taskId, { controller, gate })

    const dbConfig = appStore.getDbConfig(task.dbSourceId)
    const esConfig = appStore.getEsConfig(task.esSourceId)
    if (!dbConfig || !esConfig) {
      this.runners.delete(taskId)
      throw new Error('Source or ES data source no longer exists')
    }

    task.status = 'running'
    task.phase = 'idle'
    task.stats.startedAt = new Date().toISOString()
    task.stats.endedAt = null
    task.stats.lastError = null
    appStore.saveTask(task)
    broadcast('sync:event', { taskId, type: 'status', status: task.status, phase: task.phase })

    this.runLoop(task, dbConfig, esConfig, controller, gate).catch((err) => {
      const isAbort = err?.message === 'SYNC_ABORTED' || controller.signal.aborted
      if (!gate.aborted) {
        task.status = isAbort ? 'stopped' : 'error'
        task.stats.lastError = isAbort ? null : err?.message || String(err)
        task.stats.endedAt = new Date().toISOString()
      }
      appStore.saveTask(task)
      appStore.writeLog(
        taskId,
        `TASK ${isAbort ? 'stopped' : 'error'}: ${task.stats.lastError || ''}`
      )
      broadcast('sync:event', {
        taskId,
        type: 'status',
        status: task.status,
        phase: task.phase,
        message: isAbort ? 'Task stopped' : `Task error: ${task.stats.lastError}`,
        stats: { ...task.stats }
      })
      if (!isAbort && task.stats.lastError) {
        const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
        if (win && !win.isDestroyed()) {
          void dialog.showMessageBox(win, {
            type: 'error',
            title: '同步任务异常',
            message: `任务「${task.name}」运行失败`,
            detail: task.stats.lastError,
            buttons: ['知道了']
          })
        }
      }
      this.runners.delete(taskId)
    })
  }

  private async runLoop(
    task: SyncTask,
    dbConfig: DbConfig,
    esConfig: EsConfig,
    controller: AbortController,
    gate: SyncGate
  ): Promise<void> {
    const signal = controller.signal
    try {
      if (task.mode === 'full' || task.mode === 'full_then_incremental') {
        if (task.stats.processed === 0 || task.cursor.lastId === null) {
          // fresh baseline run
        }
        await runFullPhase(task, dbConfig, esConfig, gate)
        if (signal.aborted || gate.aborted) return
        if (task.mode === 'full') {
          task.status = 'finished'
          task.stats.endedAt = new Date().toISOString()
          task.phase = 'done'
          appStore.saveTask(task)
          broadcast('sync:event', {
            taskId: task.id,
            type: 'status',
            status: task.status,
            phase: task.phase,
            message: 'Full sync finished',
            stats: { ...task.stats }
          })
          this.runners.delete(task.id)
          return
        }
      }
      if (task.mode === 'incremental' || task.mode === 'full_then_incremental') {
        if (dbConfig.type !== 'mysql') {
          throw new Error('Incremental binlog sync currently supports MySQL sources only')
        }
        await startIncremental(task, dbConfig, esConfig, signal, gate)
      }
      if (!signal.aborted && !gate.aborted) {
        task.status = 'finished'
        task.phase = 'done'
        task.stats.endedAt = new Date().toISOString()
        appStore.saveTask(task)
        broadcast('sync:event', {
          taskId: task.id,
          type: 'status',
          status: task.status,
          phase: task.phase,
          stats: { ...task.stats }
        })
      }
    } finally {
      this.runners.delete(task.id)
    }
  }

  pause(taskId: string): void {
    const rt = this.runners.get(taskId)
    const task = appStore.listTasks().find((t) => t.id === taskId)
    if (!rt || !task) throw new Error('Task is not running')
    rt.gate.paused = true
    task.status = 'paused'
    appStore.saveTask(task)
    broadcast('sync:event', { taskId, type: 'status', status: task.status, phase: task.phase })
  }

  resume(taskId: string): void {
    const rt = this.runners.get(taskId)
    const task = appStore.listTasks().find((t) => t.id === taskId)
    if (!task) throw new Error('Task not found')
    if (!rt) {
      // resume from persisted state (previously stopped)
      task.status = 'running'
      appStore.saveTask(task)
      this.start(taskId).catch((e) => {
        task.status = 'error'
        task.stats.lastError = e?.message || String(e)
        appStore.saveTask(task)
        broadcast('sync:event', { taskId, type: 'error', status: task.status, phase: task.phase })
      })
      return
    }
    rt.gate.paused = false
    task.status = 'running'
    appStore.saveTask(task)
    broadcast('sync:event', { taskId, type: 'status', status: task.status, phase: task.phase })
  }

  async stop(taskId: string): Promise<void> {
    const rt = this.runners.get(taskId)
    const task = appStore.listTasks().find((t) => t.id === taskId)
    if (!task) throw new Error('Task not found')
    if (rt) {
      rt.controller.abort()
      // wait for the loop to observe the abort
      await new Promise((r) => setTimeout(r, 300))
      const live = this.runners.get(taskId)
      if (live) {
        live.gate.aborted = true
        live.controller.abort()
      }
    }
    task.status = 'stopped'
    task.stats.endedAt = new Date().toISOString()
    appStore.saveTask(task)
    broadcast('sync:event', {
      taskId,
      type: 'status',
      status: task.status,
      phase: task.phase,
      message: 'Task stopped (checkpoint saved)',
      stats: { ...task.stats }
    })
  }

  async restart(taskId: string): Promise<void> {
    const task = appStore.listTasks().find((t) => t.id === taskId)
    if (!task) throw new Error('Task not found')
    if (this.runners.has(taskId)) {
      await this.stop(taskId)
    }
    task.cursor.lastId = null
    task.binlog = { started: false }
    task.stats = {
      inserted: 0,
      updated: 0,
      deleted: 0,
      failed: 0,
      processed: 0,
      total: 0,
      startedAt: null,
      endedAt: null,
      latencyMs: 0,
      lastError: null
    }
    task.status = 'idle'
    appStore.saveTask(task)
    broadcast('sync:event', { taskId, type: 'status', status: task.status, phase: task.phase })
    await this.start(taskId)
  }
}

export const syncManager = new SyncManager()
