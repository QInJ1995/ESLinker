<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import type { DbConfig, EsConfig, SyncTask } from '../lib/core'
import { uid, serialize } from '../lib/core'

const emit = defineEmits<{ (e: 'snack', text: string, type?: string): void }>()

const tasks = ref<SyncTask[]>([])
const running = reactive(new Set<string>())
const statsMap = reactive(new Map<string, SyncTask['stats']>())

const dbSources = ref<DbConfig[]>([])
const esSources = ref<EsConfig[]>([])
const treeData = reactive<{ databases: string[]; tables: Map<string, string[]> }>({
  databases: [],
  tables: new Map()
})

const showForm = ref(true)
const form = reactive({
  id: '',
  name: '',
  dbSourceId: '',
  database: '',
  table: '',
  esSourceId: '',
  esIndex: '',
  primaryKey: '',
  batchSize: 1000,
  concurrency: 1,
  mode: 'full_then_incremental' as 'full' | 'incremental' | 'full_then_incremental'
})

const logTaskId = ref<string | null>(null)
const logText = ref('')

let unsubscribe: (() => void) | null = null

onMounted(async () => {
  unsubscribe = window.api.sync.onEvent((p) => {
    const t = tasks.value.find((x) => x.id === p.taskId)
    if (!t) return
    if (p.status) t.status = p.status
    if (p.phase) t.phase = p.phase
    if (p.stats) {
      t.stats = p.stats
      statsMap.set(p.taskId, p.stats)
    }
    if (t.status === 'running' || t.status === 'paused') running.add(t.id)
    else running.delete(t.id)
  })
  await refreshAll()
})

onUnmounted(() => unsubscribe?.())

async function refreshAll(): Promise<void> {
  try {
    const items = await window.api.datasource.list()
    dbSources.value = items.filter((i) => i.kind === 'db').map((i) => i.db!)
    esSources.value = items.filter((i) => i.kind === 'es').map((i) => i.es!)
    tasks.value = await window.api.sync.list()
    for (const t of tasks.value) {
      statsMap.set(t.id, t.stats)
      if (t.status === 'running' || t.status === 'paused') running.add(t.id)
    }
  } catch (e) {
    emit('snack', String((e as Error).message), 'error')
  }
}

function startCreate(): void {
  Object.assign(form, {
    id: '',
    name: '',
    dbSourceId: '',
    database: '',
    table: '',
    esSourceId: '',
    esIndex: '',
    primaryKey: '',
    batchSize: 1000,
    concurrency: 1,
    mode: 'full_then_incremental'
  })
  treeData.databases = []
  treeData.tables.clear()
  showForm.value = true
}

async function onDbSourceChange(): Promise<void> {
  const cfg = dbSources.value.find((s) => s.id === form.dbSourceId)
  if (!cfg) return
  form.database = ''
  form.table = ''
  treeData.databases = []
  treeData.tables.clear()
  try {
    const res = await window.api.datasource.tree(serialize(cfg))
    treeData.databases = res.databases
    for (const branch of res.trees) {
      treeData.tables.set(
        branch.database,
        branch.tables.map((t) => t.name)
      )
    }
  } catch (e) {
    emit('snack', String((e as Error).message), 'error')
  }
}

async function onTableChange(): Promise<void> {
  if (!form.dbSourceId || !form.database || !form.table) return
  const cfg = dbSources.value.find((s) => s.id === form.dbSourceId)
  if (!cfg) return
  try {
    const meta = await window.api.datasource.structure(serialize(cfg), form.database, form.table)
    form.primaryKey = meta.primaryKey || ''
    if (!form.esIndex) form.esIndex = meta.table
    emit(
      'snack',
      `主键：${meta.primaryKey || '未检测到（增量同步需要主键）'}`,
      meta.primaryKey ? 'success' : 'error'
    )
  } catch (e) {
    emit('snack', String((e as Error).message), 'error')
  }
}

async function saveTask(): Promise<void> {
  if (!form.name || !form.dbSourceId || !form.database || !form.table || !form.esSourceId) {
    emit('snack', '请完整填写任务信息', 'error')
    return
  }
  if (!form.primaryKey) {
    emit('snack', '该表未检测到主键，无法进行同步', 'error')
    return
  }
  const now = new Date().toISOString()
  const task: SyncTask = {
    id: form.id || uid(),
    name: form.name,
    dbSourceId: form.dbSourceId,
    database: form.database,
    table: form.table,
    esSourceId: form.esSourceId,
    esIndex: form.esIndex || form.table,
    primaryKey: form.primaryKey,
    batchSize: form.batchSize,
    concurrency: form.concurrency,
    mode: form.mode,
    status: 'idle',
    phase: 'idle',
    cursor: { lastId: null },
    binlog: { started: false },
    stats: {
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
    },
    createdAt: now
  }
  try {
    await window.api.sync.save(serialize(task))
    emit('snack', '任务已保存，点击「开始」运行', 'success')
    showForm.value = false
    await refreshAll()
  } catch (e) {
    emit('snack', String((e as Error).message), 'error')
  }
}

async function removeTask(t: SyncTask): Promise<void> {
  if (!window.confirm(`删除任务「${t.name}」？`)) return
  try {
    await window.api.sync.remove(t.id)
    await refreshAll()
  } catch (e) {
    emit('snack', String((e as Error).message), 'error')
  }
}

function action(taskId: string, op: 'start' | 'pause' | 'resume' | 'stop' | 'restart'): void {
  void window.api.sync[op](taskId).catch((e: Error) => emit('snack', String(e.message), 'error'))
}

async function viewLog(taskId: string): Promise<void> {
  logTaskId.value = taskId
  logText.value = (await window.api.log.read(taskId)) || '（暂无日志）'
}

function statusBadgeClass(s: string): string {
  if (s === 'running') return 'badge badge-running'
  if (s === 'paused') return 'badge badge-paused'
  if (s === 'finished') return 'badge badge-finished'
  if (s === 'error') return 'badge badge-error'
  if (s === 'stopped') return 'badge badge-stopped'
  return 'badge badge-idle'
}

function fmt(n: number): string {
  return n.toLocaleString()
}

function pct(t: SyncTask): string {
  if (!t.stats.total) return t.stats.processed ? '进行中' : '—'
  return Math.min(100, Math.round((t.stats.processed / t.stats.total) * 100)) + '%'
}

function srcName(id: string): string {
  return dbSources.value.find((s) => s.id === id)?.name || id.slice(0, 8)
}

function esName(id: string): string {
  return esSources.value.find((s) => s.id === id)?.name || id.slice(0, 8)
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>同步任务</h1>
      <button class="btn primary" @click="startCreate">+ 新建任务</button>
    </header>

    <section v-if="showForm" class="panel">
      <div class="panel-head">
        <h2>新建同步任务</h2>
      </div>
      <div class="form-grid">
        <label>
          任务名称
          <input v-model="form.name" type="text" placeholder="如：用户表全量+增量" />
        </label>
        <label>
          数据库数据源
          <select v-model="form.dbSourceId" @change="onDbSourceChange">
            <option value="" disabled>选择数据库</option>
            <option v-for="s in dbSources" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </label>
        <label>
          数据库
          <select v-model="form.database">
            <option value="" disabled>选择库</option>
            <option v-for="d in treeData.databases" :key="d" :value="d">{{ d }}</option>
          </select>
        </label>
        <label>
          数据表
          <select v-model="form.table" @change="onTableChange">
            <option value="" disabled>选择表</option>
            <option v-for="t in treeData.tables.get(form.database) || []" :key="t" :value="t">
              {{ t }}
            </option>
          </select>
        </label>
        <label>
          ES 数据源
          <select v-model="form.esSourceId">
            <option value="" disabled>选择 ES</option>
            <option v-for="s in esSources" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </label>
        <label>
          目标索引
          <input v-model="form.esIndex" type="text" />
        </label>
        <label>
          主键字段
          <input v-model="form.primaryKey" type="text" />
        </label>
        <label>
          同步模式
          <select v-model="form.mode">
            <option value="full">全量同步</option>
            <option value="incremental">增量同步（Binlog）</option>
            <option value="full_then_incremental">先全量后增量</option>
          </select>
        </label>
        <label>
          批次大小
          <input v-model.number="form.batchSize" type="number" min="100" />
        </label>
        <label>
          并发数
          <input v-model.number="form.concurrency" type="number" min="1" max="8" />
        </label>
      </div>
      <div class="row-end">
        <button class="btn" @click="showForm = false">取消</button>
        <button class="btn primary" @click="saveTask">保存任务</button>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>任务列表（{{ tasks.length }}）</h2>
      </div>
      <div v-if="tasks.length === 0" class="empty">暂无任务，点击「新建任务」创建</div>
      <div v-else class="task-list">
        <div v-for="t in tasks" :key="t.id" class="task-card">
          <div class="task-main">
            <div class="task-title">
              <b>{{ t.name }}</b>
              <span :class="statusBadgeClass(t.status)">{{
                t.status === 'paused' ? '已暂停' : t.status
              }}</span>
              <span class="badge badge-mode">{{
                t.mode === 'full' ? '全量' : t.mode === 'incremental' ? '增量' : '全量+增量'
              }}</span>
            </div>
            <div class="task-route mono">
              {{ srcName(t.dbSourceId) }} → {{ t.database }}.{{ t.table }}
              <span class="arr">⟶</span>
              {{ esName(t.esSourceId) }} / {{ t.esIndex }}
            </div>
            <div class="task-stats">
              <span
                >已同步 <b>{{ fmt(t.stats.processed) }}</b></span
              >
              <span
                >总数 <b>{{ fmt(t.stats.total) }}</b></span
              >
              <span class="bar">
                <i
                  :style="{ width: pct(t) === '进行中' ? '50%' : pct(t) === '—' ? '0%' : pct(t) }"
                ></i>
              </span>
              <span
                >进度 <b>{{ pct(t) }}</b></span
              >
              <span class="sep">｜</span>
              <span
                >插入 <b class="up">{{ fmt(t.stats.inserted) }}</b></span
              >
              <span
                >更新 <b class="up">{{ fmt(t.stats.updated) }}</b></span
              >
              <span
                >删除 <b class="del">{{ fmt(t.stats.deleted) }}</b></span
              >
              <span
                >失败 <b :class="{ del: t.stats.failed > 0 }">{{ fmt(t.stats.failed) }}</b></span
              >
            </div>
            <div v-if="t.stats.lastError" class="task-error">⚠ {{ t.stats.lastError }}</div>
          </div>
          <div class="task-ops">
            <template v-if="running.has(t.id) && t.status === 'running'">
              <button class="btn" @click="action(t.id, 'pause')">暂停</button>
              <button class="btn danger-ghost" @click="action(t.id, 'stop')">停止</button>
            </template>
            <template v-else-if="running.has(t.id) && t.status === 'paused'">
              <button class="btn" @click="action(t.id, 'resume')">继续</button>
              <button class="btn danger-ghost" @click="action(t.id, 'stop')">停止</button>
            </template>
            <template v-else>
              <button class="btn primary" @click="action(t.id, 'start')">开始</button>
              <button class="btn" @click="action(t.id, 'restart')">重启</button>
            </template>
            <button class="btn" @click="viewLog(t.id)">日志</button>
            <button class="btn danger-ghost" @click="removeTask(t)">删除</button>
          </div>
        </div>
      </div>
    </section>

    <div v-if="logTaskId" class="modal-mask" @click.self="logTaskId = null">
      <div class="modal wide">
        <div class="modal-head">
          <h3>任务日志</h3>
          <button class="btn ghost" @click="logTaskId = null">✕</button>
        </div>
        <div class="modal-body">
          <pre class="log-pre">{{ logText }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: 1180px;
}

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}

.page-head h1 {
  margin: 0;
  font-size: 22px;
}

.panel {
  background: var(--es-panel);
  border: 1px solid var(--es-border);
  border-radius: 12px;
  padding: 16px 18px;
  margin-bottom: 18px;
}

.panel-head h2 {
  margin: 0 0 12px;
  font-size: 15px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12.5px;
  color: var(--es-text-2);
}

input,
select {
  padding: 8px 10px;
  border: 1px solid var(--es-border);
  border-radius: 7px;
  font-size: 13px;
  background: #fff;
  color: var(--es-text);
}

.row-end {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}

.btn {
  padding: 6px 12px;
  border: 1px solid var(--es-border);
  background: #fff;
  border-radius: 7px;
  font-size: 12.5px;
  cursor: pointer;
  color: var(--es-text);
}

.btn + .btn {
  margin-left: 6px;
}

.btn.primary {
  background: var(--es-primary);
  border-color: var(--es-primary);
  color: #fff;
}

.btn.danger-ghost {
  border-color: transparent;
  background: transparent;
  color: var(--es-danger);
}

.btn.danger-ghost:hover {
  background: #fee2e2;
}

.empty {
  padding: 26px;
  text-align: center;
  color: var(--es-text-3);
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.task-card {
  border: 1px solid var(--es-border);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 14px;
}

.task-main {
  flex: 1;
  min-width: 0;
}

.task-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-title b {
  font-size: 14px;
}

.badge {
  padding: 2px 9px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
}

.badge-running {
  background: #dcfce7;
  color: #15803d;
}

.badge-paused {
  background: #fef9c3;
  color: #a16207;
}

.badge-finished {
  background: #e0f2fe;
  color: #0369a1;
}

.badge-error {
  background: #fee2e2;
  color: #b91c1c;
}

.badge-stopped {
  background: #f1f5f9;
  color: #475569;
}

.badge-idle {
  background: #f1f5f9;
  color: #64748b;
}

.badge-mode {
  background: #eef2ff;
  color: #4338ca;
}

.task-route {
  margin-top: 6px;
  color: var(--es-text-2);
  font-size: 12.5px;
}

.arr {
  margin: 0 6px;
  color: var(--es-text-3);
}

.task-stats {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 12px;
  color: var(--es-text-2);
  flex-wrap: wrap;
}

.task-stats b {
  color: var(--es-text);
}

.up {
  color: #15803d;
}

.del {
  color: #b91c1c;
}

.bar {
  display: inline-block;
  width: 120px;
  height: 7px;
  background: #e8ebf0;
  border-radius: 6px;
  overflow: hidden;
}

.bar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #2563eb, #38bdf8);
  border-radius: 6px;
}

.sep {
  color: var(--es-border);
}

.task-error {
  margin-top: 6px;
  color: #b91c1c;
  font-size: 12px;
  background: #fef2f2;
  border-radius: 6px;
  padding: 5px 8px;
}

.task-ops {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.mono {
  font-family: ui-monospace, Menlo, monospace;
}

.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal {
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
  max-width: 92vw;
}

.modal.wide {
  width: 720px;
}

.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--es-border);
}

.modal-head h3 {
  margin: 0;
  font-size: 15px;
}

.modal-body {
  padding: 14px 18px;
}

.log-pre {
  background: #0f172a;
  color: #cbd5e1;
  padding: 14px;
  border-radius: 8px;
  font-size: 12px;
  max-height: 420px;
  overflow: auto;
  white-space: pre-wrap;
  font-family: ui-monospace, Menlo, monospace;
}
</style>
