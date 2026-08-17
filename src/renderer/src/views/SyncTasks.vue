<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, h } from 'vue'
import {
  NButton,
  NSpace,
  NInput,
  NInputNumber,
  NSelect,
  NTag,
  NProgress,
  NEmpty,
  NCard,
  NDataTable,
  NModal,
  NForm,
  NFormItem,
  NGrid,
  NGridItem
} from 'naive-ui'
import type { DbConfig, EsConfig, SyncTask } from '../lib/core'
import { uid, serialize } from '../lib/core'
import { message, confirmDanger } from '../lib/naive'

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

const dbSourceOptions = computed(() => dbSources.value.map((s) => ({ label: s.name, value: s.id })))
const esSourceOptions = computed(() => esSources.value.map((s) => ({ label: s.name, value: s.id })))
const dbOptions = computed(() => treeData.databases.map((d) => ({ label: d, value: d })))
const tableOptions = computed(() =>
  (treeData.tables.get(form.database) || []).map((t) => ({ label: t, value: t }))
)

const modeOptions = [
  { label: '全量同步', value: 'full' },
  { label: '增量同步（Binlog）', value: 'incremental' },
  { label: '先全量后增量', value: 'full_then_incremental' }
]

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
    message.error(String((e as Error).message))
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
    message.error(String((e as Error).message))
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
    if (meta.primaryKey) message.success(`主键：${meta.primaryKey}`)
    else message.error('未检测到主键（增量同步需要主键）')
  } catch (e) {
    message.error(String((e as Error).message))
  }
}

async function saveTask(): Promise<void> {
  if (!form.name || !form.dbSourceId || !form.database || !form.table || !form.esSourceId) {
    message.error('请完整填写任务信息')
    return
  }
  if (!form.primaryKey) {
    message.error('该表未检测到主键，无法进行同步')
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
    message.success('任务已保存，点击「开始」运行')
    showForm.value = false
    await refreshAll()
  } catch (e) {
    message.error(String((e as Error).message))
  }
}

function removeTask(t: SyncTask): void {
  confirmDanger(`删除任务「${t.name}」？`, async () => {
    try {
      await window.api.sync.remove(t.id)
      await refreshAll()
      message.success('已删除')
    } catch (e) {
      message.error(String((e as Error).message))
    }
  })
}

function action(taskId: string, op: 'start' | 'pause' | 'resume' | 'stop' | 'restart'): void {
  void window.api.sync[op](taskId).catch((e: Error) => message.error(String(e.message)))
}

async function viewLog(taskId: string): Promise<void> {
  logTaskId.value = taskId
  logText.value = (await window.api.log.read(taskId)) || '（暂无日志）'
}

function statusOf(t: SyncTask): string {
  return t.status === 'paused' ? '已暂停' : t.status
}

function statusType(s: string): 'success' | 'warning' | 'info' | 'error' | 'default' {
  if (s === 'running') return 'success'
  if (s === 'paused') return 'warning'
  if (s === 'finished') return 'info'
  if (s === 'error') return 'error'
  return 'default'
}

function modeLabel(t: SyncTask): string {
  if (t.mode === 'full') return '全量'
  if (t.mode === 'incremental') return '增量'
  return '全量+增量'
}

function pct(t: SyncTask): number {
  if (!t.stats.total) return t.stats.processed ? -1 : 0
  return Math.min(100, Math.round((t.stats.processed / t.stats.total) * 100))
}

function fmt(n: number): string {
  return n.toLocaleString()
}

function srcName(id: string): string {
  return dbSources.value.find((s) => s.id === id)?.name || id.slice(0, 8)
}

function esName(id: string): string {
  return esSources.value.find((s) => s.id === id)?.name || id.slice(0, 8)
}

const taskColumns = computed(() => [
  {
    title: '任务',
    key: 'name',
    minWidth: 230,
    render: (t: SyncTask) =>
      h('div', {}, [
        h('b', {}, t.name),
        h('div', { class: 'mono route' }, [
          `${srcName(t.dbSourceId)} → ${t.database}.${t.table}`,
          h('span', { class: 'arr' }, ' ⟶ '),
          `${esName(t.esSourceId)} / ${t.esIndex}`
        ]),
        t.stats.lastError ? h('div', { class: 'task-error' }, `⚠ ${t.stats.lastError}`) : null
      ])
  },
  {
    title: '模式',
    key: 'mode',
    width: 92,
    render: (t: SyncTask) =>
      h(NTag, { size: 'small', type: 'primary', bordered: false }, { default: () => modeLabel(t) })
  },
  {
    title: '状态',
    key: 'status',
    width: 88,
    render: (t: SyncTask) =>
      h(
        NTag,
        { size: 'small', type: statusType(t.status), bordered: false },
        { default: () => statusOf(t) }
      )
  },
  {
    title: '进度',
    key: 'progress',
    width: 170,
    render: (t: SyncTask) => {
      const p = pct(t)
      const indefinite = !t.stats.total && t.stats.processed > 0
      return h(NProgress, {
        type: 'line',
        height: 6,
        percentage: indefinite ? 40 : p,
        processing: indefinite || t.status === 'running',
        status: t.status === 'error' ? 'error' : undefined,
        indicatorPlacement: 'outside'
      })
    }
  },
  {
    title: '同步统计',
    key: 'stats',
    width: 230,
    render: (t: SyncTask) =>
      h('div', { class: 'stats-line' }, [
        h('span', {}, [`已同步 `, h('b', {}, fmt(t.stats.processed))]),
        h('span', {}, [`总数 `, h('b', {}, fmt(t.stats.total))]),
        h('span', {}, [`插入 `, h('b', { class: 'ok' }, fmt(t.stats.inserted))]),
        h('span', {}, [`更新 `, h('b', { class: 'ok' }, fmt(t.stats.updated))]),
        h('span', {}, [`删除 `, h('b', { class: 'del' }, fmt(t.stats.deleted))]),
        h('span', {}, [
          `失败 `,
          h('b', { class: t.stats.failed > 0 ? 'del' : '' }, fmt(t.stats.failed))
        ])
      ])
  },
  {
    title: '操作',
    key: 'ops',
    width: 260,
    render: (t: SyncTask) => {
      const isRun = running.has(t.id) && t.status === 'running'
      const isPaused = running.has(t.id) && t.status === 'paused'
      return h(
        NSpace,
        { size: 4 },
        {
          default: () => [
            isRun
              ? h(
                  NButton,
                  { size: 'small', onClick: () => action(t.id, 'pause') },
                  { default: () => '暂停' }
                )
              : isPaused
                ? h(
                    NButton,
                    { size: 'small', onClick: () => action(t.id, 'resume') },
                    { default: () => '继续' }
                  )
                : h(
                    NButton,
                    { size: 'small', type: 'primary', onClick: () => action(t.id, 'start') },
                    { default: () => '开始' }
                  ),
            isRun || isPaused
              ? h(
                  NButton,
                  {
                    size: 'small',
                    type: 'error',
                    quaternary: true,
                    onClick: () => action(t.id, 'stop')
                  },
                  { default: () => '停止' }
                )
              : h(
                  NButton,
                  { size: 'small', onClick: () => action(t.id, 'restart') },
                  { default: () => '重启' }
                ),
            h(
              NButton,
              { size: 'small', quaternary: true, onClick: () => viewLog(t.id) },
              { default: () => '日志' }
            ),
            h(
              NButton,
              { size: 'small', type: 'error', quaternary: true, onClick: () => removeTask(t) },
              { default: () => '删除' }
            )
          ]
        }
      )
    }
  }
])
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1 class="page-title">同步任务</h1>
        <p class="page-sub">全量分页批量 + Binlog 实时增量，断点续传</p>
      </div>
      <n-button type="primary" size="small" @click="startCreate">+ 新建任务</n-button>
    </header>

    <n-card v-if="showForm" class="panel-card">
      <template #header>新建同步任务</template>
      <n-form label-placement="top" :show-feedback="false">
        <n-grid :cols="4" :x-gap="14" :y-gap="0" responsive="screen" item-responsive>
          <n-grid-item>
            <n-form-item label="任务名称">
              <n-input v-model:value="form.name" placeholder="如：用户表全量+增量" />
            </n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="数据库数据源">
              <n-select
                v-model:value="form.dbSourceId"
                placeholder="选择数据库"
                :options="dbSourceOptions"
                :on-update:value="onDbSourceChange"
              />
            </n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="数据库">
              <n-select
                v-model:value="form.database"
                placeholder="选择库"
                :options="dbOptions"
                :disabled="!form.dbSourceId"
              />
            </n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="数据表">
              <n-select
                v-model:value="form.table"
                placeholder="选择表"
                :options="tableOptions"
                :disabled="!form.database"
                :on-update:value="onTableChange"
              />
            </n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="ES 数据源">
              <n-select
                v-model:value="form.esSourceId"
                placeholder="选择 ES"
                :options="esSourceOptions"
              />
            </n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="目标索引">
              <n-input v-model:value="form.esIndex" placeholder="将自动填入表名" />
            </n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="主键字段">
              <n-input v-model:value="form.primaryKey" placeholder="选择表后自动检测" />
            </n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="同步模式">
              <n-select v-model:value="form.mode" :options="modeOptions" />
            </n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="批次大小"
              ><n-input-number
                v-model:value="form.batchSize"
                :min="100"
                :step="100"
                style="width: 100%"
            /></n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="并发数"
              ><n-input-number
                v-model:value="form.concurrency"
                :min="1"
                :max="8"
                style="width: 100%"
            /></n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label=" ">
              <n-space>
                <n-button @click="showForm = false">取消</n-button>
                <n-button type="primary" @click="saveTask">保存任务</n-button>
              </n-space>
            </n-form-item>
          </n-grid-item>
        </n-grid>
      </n-form>
    </n-card>

    <n-card class="panel-card">
      <template #header>任务列表（{{ tasks.length }}）</template>
      <n-data-table
        v-if="tasks.length"
        :columns="taskColumns"
        :data="tasks"
        :bordered="false"
        size="small"
      />
      <n-empty v-else description="暂无任务，点击「新建任务」创建" style="padding: 26px 0" />
    </n-card>

    <n-modal
      v-model:show="logTaskId"
      preset="card"
      title="任务日志"
      style="width: 720px; max-width: 92vw"
    >
      <pre class="log-pre">{{ logText }}</pre>
      <template #footer>
        <div class="modal-foot">
          <n-button type="primary" @click="logTaskId = null">关闭</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.page {
  max-width: 1200px;
}

.panel-card {
  margin-bottom: 16px;
}

.route {
  font-size: 12px;
  opacity: 0.6;
  margin-top: 4px;
}

.arr {
  color: #999;
}

.task-error {
  margin-top: 5px;
  font-size: 12px;
  color: #d03050;
}

.stats-line {
  display: flex;
  gap: 10px;
  font-size: 12px;
  opacity: 0.85;
  flex-wrap: wrap;
}

.stats-line b {
  font-weight: 600;
}

.ok {
  color: #18a058;
}

.del {
  color: #d03050;
}

.log-pre {
  background: #0f172a;
  color: #cbd5e1;
  padding: 14px;
  border-radius: 8px;
  font-size: 12px;
  max-height: 60vh;
  overflow: auto;
  white-space: pre-wrap;
  font-family: ui-monospace, Menlo, monospace;
}

.modal-foot {
  display: flex;
  justify-content: flex-end;
}
</style>
