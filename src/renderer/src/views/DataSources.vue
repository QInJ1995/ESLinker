<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import type { DataSourceItem, DbConfig, EsConfig } from '../lib/core'
import { DB_TYPE_LABELS, uid, serialize } from '../lib/core'

const emit = defineEmits<{
  (e: 'snack', text: string, type?: string): void
  (e: 'open-mapping', ctx: { cfg: DbConfig; database: string; table: string }): void
}>()

const dbSources = ref<DbConfig[]>([])
const esSources = ref<EsConfig[]>([])
const loading = ref(false)

const modal = reactive<{ open: boolean; kind: 'db' | 'es'; editing: boolean }>({
  open: false,
  kind: 'db',
  editing: false
})

const dbForm = reactive<DbConfig>({
  id: '',
  name: '',
  type: 'mysql',
  host: '127.0.0.1',
  port: 3306,
  username: 'root',
  password: '',
  database: '',
  useSsl: false
})

const esForm = reactive<EsConfig>({
  id: '',
  name: '',
  secure: false,
  host: '127.0.0.1',
  port: 9200,
  username: '',
  password: '',
  apiKey: '',
  version: '8'
})

const tree = ref<{ cfg: DbConfig; databases: string[]; tables: Map<string, string[]> } | null>(null)
const treeLoading = ref(false)
const expanded = reactive(new Set<string>())

onMounted(refresh)

async function refresh(): Promise<void> {
  loading.value = true
  try {
    const items = await window.api.datasource.list()
    dbSources.value = items
      .filter((i) => i.kind === 'db')
      .map((i) => i.db!)
      .filter(Boolean)
    esSources.value = items
      .filter((i) => i.kind === 'es')
      .map((i) => i.es!)
      .filter(Boolean)
  } catch (e) {
    emit('snack', String((e as Error).message), 'error')
  } finally {
    loading.value = false
  }
}

function openDbForm(item?: DbConfig): void {
  modal.open = true
  modal.kind = 'db'
  modal.editing = Boolean(item)
  Object.assign(dbForm, {
    id: item?.id || uid(),
    name: item?.name || '',
    type: item?.type || 'mysql',
    host: item?.host || '127.0.0.1',
    port: item?.port || 3306,
    username: item?.username || '',
    password: '',
    database: item?.database || '',
    useSsl: item?.useSsl || false
  })
}

function openEsForm(item?: EsConfig): void {
  modal.open = true
  modal.kind = 'es'
  modal.editing = Boolean(item)
  Object.assign(esForm, {
    id: item?.id || uid(),
    name: item?.name || '',
    secure: item?.secure || false,
    host: item?.host || '127.0.0.1',
    port: item?.port || 9200,
    username: item?.username || '',
    password: '',
    apiKey: item?.apiKey || '',
    version: item?.version || '8'
  })
}

async function testConnection(): Promise<void> {
  try {
    let payload: DataSourceItem
    if (modal.kind === 'db') {
      const cfg = { ...dbForm }
      if (!cfg.password) {
        const stored = dbSources.value.find((s) => s.id === cfg.id)
        if (stored?.password) cfg.password = stored.password
      }
      payload = { kind: 'db', db: serialize(cfg) }
    } else {
      const cfg = { ...esForm }
      if (!cfg.password) {
        const stored = esSources.value.find((s) => s.id === cfg.id)
        if (stored?.password) cfg.password = stored.password
      }
      payload = { kind: 'es', es: serialize(cfg) }
    }
    const res = await window.api.datasource.test(payload)
    emit('snack', res.version ? `ES 连接成功：${res.version}` : '数据库连接成功', 'success')
  } catch (e) {
    emit('snack', `连接失败：${(e as Error).message}`, 'error')
  }
}

async function save(): Promise<void> {
  try {
    if (modal.kind === 'db') {
      const cfg: DbConfig = { ...dbForm }
      if (!cfg.password) {
        const stored = dbSources.value.find((s) => s.id === cfg.id)
        cfg.password = stored?.password || ''
      }
      await window.api.datasource.save({ kind: 'db', db: serialize(cfg) })
    } else {
      const cfg: EsConfig = { ...esForm }
      if (!cfg.password) {
        const stored = esSources.value.find((s) => s.id === cfg.id)
        cfg.password = stored?.password || ''
      }
      await window.api.datasource.save({ kind: 'es', es: serialize(cfg) })
    }
    modal.open = false
    emit('snack', '已保存', 'success')
    await refresh()
  } catch (e) {
    emit('snack', String((e as Error).message), 'error')
  }
}

async function remove(kind: 'db' | 'es', item: { id: string; name: string }): Promise<void> {
  if (!window.confirm(`删除数据源「${item.name}」？`)) return
  try {
    await window.api.datasource.remove(kind, item.id)
    await refresh()
    emit('snack', '已删除')
  } catch (e) {
    emit('snack', String((e as Error).message), 'error')
  }
}

async function loadTree(cfg: DbConfig): Promise<void> {
  if (tree.value?.cfg.id === cfg.id) {
    tree.value = null
    return
  }
  treeLoading.value = true
  try {
    const res = await window.api.datasource.tree(serialize(cfg))
    const tables = new Map<string, string[]>()
    for (const branch of res.trees) {
      tables.set(
        branch.database,
        branch.tables.map((t) => t.name)
      )
    }
    tree.value = { cfg, databases: res.databases, tables }
    expanded.clear()
    // 如果配置了默认数据库，自动展开它
    if (cfg.database && res.databases.includes(cfg.database)) {
      expanded.add(cfg.database)
    }
  } catch (e) {
    console.error('loadTree', e)
    emit('snack', `加载表结构失败：${(e as Error).message}`, 'error')
  } finally {
    treeLoading.value = false
  }
}

function toggleDb(name: string): void {
  if (expanded.has(name)) expanded.delete(name)
  else expanded.add(name)
}

function clickTable(database: string, table: string): void {
  emit('open-mapping', { cfg: tree.value!.cfg, database, table })
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>数据源管理</h1>
      <p>本地加密存储连接配置，数据不上传任何第三方服务</p>
    </header>

    <section class="panel">
      <div class="panel-head">
        <h2>数据库（MySQL / PostgreSQL / SQL Server）</h2>
        <button class="btn primary" @click="openDbForm()">+ 新增数据库</button>
      </div>
      <div v-if="dbSources.length === 0" class="empty">暂无数据库数据源，点击右上角新增</div>
      <table v-else class="tbl">
        <thead>
          <tr>
            <th>名称</th>
            <th>类型</th>
            <th>地址</th>
            <th>数据库</th>
            <th class="ops">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in dbSources" :key="s.id">
            <td>
              <div class="cell-main">{{ s.name }}</div>
            </td>
            <td>
              <span class="badge badge-db">{{ s.type }}</span>
            </td>
            <td class="mono">{{ s.host }}:{{ s.port }}</td>
            <td class="mono">{{ s.database || '—' }}</td>
            <td class="ops">
              <button class="btn ghost" @click="loadTree(s)">
                {{ tree?.cfg.id === s.id ? '收起' : '表结构' }}
              </button>
              <button class="btn ghost" @click="openDbForm(s)">编辑</button>
              <button class="btn danger-ghost" @click="remove('db', s)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="tree" class="panel tree-panel">
      <div class="panel-head">
        <h2>表结构 · {{ tree.cfg.name }}</h2>
        <span v-if="treeLoading" class="muted">加载中…</span>
      </div>
      <div class="tree">
        <div v-for="db in tree.databases" :key="db" class="tree-branch">
          <div class="tree-node" @click="toggleDb(db)">
            <span class="twist">{{ expanded.has(db) ? '▾' : '▸' }}</span>
            <span class="db-icon">▤</span>{{ db }}
            <span class="muted count">{{ tree.tables.get(db)?.length || 0 }}</span>
          </div>
          <div v-if="expanded.has(db)" class="tree-children">
            <div v-if="(tree.tables.get(db) || []).length === 0" class="muted tree-leaf">
              （无表）
            </div>
            <div
              v-for="t in tree.tables.get(db) || []"
              :key="t"
              class="tree-leaf clickable"
              title="打开 Mapping 编辑器"
              @click="clickTable(db, t)"
            >
              ▦ {{ t }}
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>Elasticsearch</h2>
        <button class="btn primary" @click="openEsForm()">+ 新增 ES</button>
      </div>
      <div v-if="esSources.length === 0" class="empty">暂无 ES 数据源，点击右上角新增</div>
      <table v-else class="tbl">
        <thead>
          <tr>
            <th>名称</th>
            <th>地址</th>
            <th>版本</th>
            <th class="ops">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in esSources" :key="s.id">
            <td>
              <div class="cell-main">{{ s.name }}</div>
            </td>
            <td class="mono">{{ s.secure ? 'https' : 'http' }}://{{ s.host }}:{{ s.port }}</td>
            <td>
              <span class="badge badge-es">ES {{ s.version }}</span>
            </td>
            <td class="ops">
              <button class="btn ghost" @click="openEsForm(s)">编辑</button>
              <button class="btn danger-ghost" @click="remove('es', s)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <div v-if="modal.open" class="modal-mask" @click.self="modal.open = false">
      <div class="modal">
        <div class="modal-head">
          <h3>
            {{ modal.editing ? '编辑' : '新增' }}{{ modal.kind === 'db' ? '数据库' : 'ES 数据源' }}
          </h3>
          <button class="btn ghost" @click="modal.open = false">✕</button>
        </div>
        <div class="modal-body">
          <template v-if="modal.kind === 'db'">
            <div class="form-grid">
              <label>
                名称
                <input v-model="dbForm.name" type="text" placeholder="如：本地开发库" />
              </label>
              <label>
                类型
                <select v-model="dbForm.type">
                  <option v-for="t in DB_TYPE_LABELS" :key="t.value" :value="t.value">
                    {{ t.label }}
                  </option>
                </select>
              </label>
              <label>
                Host
                <input v-model="dbForm.host" type="text" />
              </label>
              <label>
                Port
                <input v-model.number="dbForm.port" type="number" />
              </label>
              <label>
                用户名
                <input v-model="dbForm.username" type="text" autocomplete="off" />
              </label>
              <label>
                密码
                <input
                  v-model="dbForm.password"
                  type="password"
                  autocomplete="new-password"
                  :placeholder="modal.editing ? '留空表示保持不变' : ''"
                />
              </label>
              <label>
                默认数据库（可选）
                <input v-model="dbForm.database" type="text" placeholder="可不填，连接后浏览" />
              </label>
              <label class="chk-label">
                <input v-model="dbForm.useSsl" type="checkbox" /> 使用 SSL（PG/SQLServer）
              </label>
            </div>
          </template>
          <template v-else>
            <div class="form-grid">
              <label>
                名称
                <input v-model="esForm.name" type="text" placeholder="如：测试集群" />
              </label>
              <label>
                版本
                <select v-model="esForm.version">
                  <option value="8">ES 8</option>
                  <option value="7">ES 7</option>
                </select>
              </label>
              <label>
                Host
                <input v-model="esForm.host" type="text" />
              </label>
              <label>
                Port
                <input v-model.number="esForm.port" type="number" />
              </label>
              <label class="chk-label">
                <input v-model="esForm.secure" type="checkbox" /> HTTPS（安全连接）
              </label>
              <label>
                用户名
                <input v-model="esForm.username" type="text" autocomplete="off" />
              </label>
              <label>
                密码
                <input
                  v-model="esForm.password"
                  type="password"
                  autocomplete="new-password"
                  :placeholder="modal.editing ? '留空表示保持不变' : ''"
                />
              </label>
              <label>
                API Key（可选，优先于账号密码）
                <input v-model="esForm.apiKey" type="password" autocomplete="off" />
              </label>
            </div>
          </template>
        </div>
        <div class="modal-foot">
          <button class="btn" @click="modal.open = false">取消</button>
          <button class="btn" @click="testConnection">测试连接</button>
          <button class="btn primary" @click="save">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: 1080px;
}

.page-head h1 {
  margin: 0 0 6px;
  font-size: 22px;
}

.page-head p {
  margin: 0 0 20px;
  color: var(--es-text-2);
}

.panel {
  background: var(--es-panel);
  border: 1px solid var(--es-border);
  border-radius: 12px;
  padding: 16px 18px;
  margin-bottom: 18px;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.panel-head h2 {
  margin: 0;
  font-size: 15px;
}

.tbl {
  width: 100%;
  border-collapse: collapse;
}

.tbl th,
.tbl td {
  text-align: left;
  padding: 9px 10px;
  border-bottom: 1px solid var(--es-border);
  font-size: 13px;
}

.tbl th {
  color: var(--es-text-3);
  font-weight: 500;
  font-size: 12px;
}

.tbl tr:last-child td {
  border-bottom: 0;
}

.cell-main {
  font-weight: 600;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: var(--es-text-2);
}

.badge {
  padding: 2px 8px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
}

.badge-db {
  background: #eef2ff;
  color: #4338ca;
}

.badge-es {
  background: #fff7ed;
  color: #c2410c;
}

.ops {
  width: 230px;
  text-align: right;
  white-space: nowrap;
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

.btn:hover {
  border-color: #b9c1cd;
}

.btn.primary {
  background: var(--es-primary);
  border-color: var(--es-primary);
  color: #fff;
}

.btn.primary:hover {
  background: var(--es-primary-dark);
}

.btn.ghost {
  border-color: transparent;
  background: transparent;
  color: var(--es-primary);
}

.btn.ghost:hover {
  background: #eef2ff;
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
  padding: 22px;
  text-align: center;
  color: var(--es-text-3);
}

.tree-panel .panel-head h2 {
  font-size: 14px;
}

.tree {
  max-height: 380px;
  overflow: auto;
  border: 1px solid var(--es-border);
  border-radius: 8px;
  padding: 8px;
}

.tree-node,
.tree-leaf {
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 13px;
}

.tree-node {
  cursor: pointer;
  font-weight: 600;
}

.tree-node:hover {
  background: #f0f3f8;
}

.tree-children {
  padding-left: 18px;
}

.tree-leaf {
  color: var(--es-text-2);
}

.tree-leaf.clickable {
  cursor: pointer;
}

.tree-leaf.clickable:hover {
  background: #eef4ff;
  color: var(--es-primary);
}

.twist {
  display: inline-block;
  width: 12px;
  color: var(--es-text-3);
}

.db-icon {
  margin-right: 4px;
}

.count {
  margin-left: 6px;
}

.muted {
  color: var(--es-text-3);
  font-size: 12px;
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
  width: 520px;
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
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
  padding: 16px 18px;
}

.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--es-border);
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
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
  color: var(--es-text);
  background: #fff;
}

.chk-label {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
</style>
