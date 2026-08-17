<script setup lang="ts">
import { ref, reactive, computed, onMounted, h } from 'vue'
import {
  NButton,
  NSpace,
  NTag,
  NInput,
  NInputNumber,
  NSelect,
  NSwitch,
  NEmpty,
  NCard
} from 'naive-ui'
import type { DataSourceItem, DbConfig, EsConfig } from '../lib/core'
import { DB_TYPE_LABELS, uid, serialize } from '../lib/core'
import { message, confirmDanger } from '../lib/naive'

const emit = defineEmits<{
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
const testing = ref(false)
const saving = ref(false)

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
const expandedKeys = ref<string[]>([])

const dbColumns = computed(() => [
  {
    title: '名称',
    key: 'name',
    width: 180,
    render: (row: DbConfig) => h('b', { style: 'font-weight:600' }, row.name)
  },
  {
    title: '类型',
    key: 'type',
    width: 130,
    render: (row: DbConfig) =>
      h(NTag, { size: 'small', type: 'primary', bordered: false }, { default: () => row.type })
  },
  {
    title: '地址',
    key: 'host',
    render: (row: DbConfig) => h('span', { class: 'mono' }, `${row.host}:${row.port}`)
  },
  {
    title: '默认数据库',
    key: 'database',
    width: 140,
    render: (row: DbConfig) => row.database || '—'
  },
  {
    title: '操作',
    key: 'ops',
    width: 240,
    render: (row: DbConfig) =>
      h(
        NSpace,
        { size: 6 },
        {
          default: () => [
            h(
              NButton,
              {
                size: 'small',
                quaternary: tree.value?.cfg.id === row.id,
                onClick: () => loadTree(row)
              },
              { default: () => (tree.value?.cfg.id === row.id ? '收起' : '表结构') }
            ),
            h(
              NButton,
              { size: 'small', onClick: () => openDbForm(row) },
              { default: () => '编辑' }
            ),
            h(
              NButton,
              {
                size: 'small',
                type: 'error',
                quaternary: true,
                onClick: () => remove('db', row)
              },
              { default: () => '删除' }
            )
          ]
        }
      )
  }
])

const esColumns = computed(() => [
  {
    title: '名称',
    key: 'name',
    width: 180,
    render: (row: EsConfig) => h('b', { style: 'font-weight:600' }, row.name)
  },
  {
    title: '地址',
    key: 'host',
    render: (row: EsConfig) =>
      h('span', { class: 'mono' }, `${row.secure ? 'https' : 'http'}://${row.host}:${row.port}`)
  },
  {
    title: '版本',
    key: 'version',
    width: 120,
    render: (row: EsConfig) =>
      h(
        NTag,
        { size: 'small', type: 'warning', bordered: false },
        { default: () => `ES ${row.version}` }
      )
  },
  {
    title: '操作',
    key: 'ops',
    width: 150,
    render: (row: EsConfig) =>
      h(
        NSpace,
        { size: 6 },
        {
          default: () => [
            h(
              NButton,
              { size: 'small', onClick: () => openEsForm(row) },
              { default: () => '编辑' }
            ),
            h(
              NButton,
              { size: 'small', type: 'error', quaternary: true, onClick: () => remove('es', row) },
              { default: () => '删除' }
            )
          ]
        }
      )
  }
])

const treeOptions = computed(() => {
  if (!tree.value) return []
  return tree.value.databases.map((db) => ({
    key: `db:${db}`,
    label: db,
    children: (tree.value!.tables.get(db) || []).map((t) => ({
      key: `tb:${db}::${t}`,
      label: t,
      isLeaf: true
    }))
  }))
})

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
    message.error(String((e as Error).message))
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
  testing.value = true
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
    message.success(res.version ? `ES 连接成功：${res.version}` : '数据库连接成功')
  } catch (e) {
    message.error(`连接失败：${(e as Error).message}`)
  } finally {
    testing.value = false
  }
}

async function save(): Promise<void> {
  saving.value = true
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
    message.success('已保存')
    await refresh()
  } catch (e) {
    message.error(String((e as Error).message))
  } finally {
    saving.value = false
  }
}

function remove(kind: 'db' | 'es', item: { id: string; name: string }): void {
  confirmDanger(`删除数据源「${item.name}」？`, async () => {
    try {
      await window.api.datasource.remove(kind, item.id)
      if (tree.value?.cfg.id === item.id) tree.value = null
      await refresh()
      message.success('已删除')
    } catch (e) {
      message.error(String((e as Error).message))
    }
  })
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
    expandedKeys.value = []
    if (cfg.database && res.databases.includes(cfg.database)) {
      expandedKeys.value = [`db:${cfg.database}`]
    }
  } catch (e) {
    console.error('loadTree', e)
    message.error(`加载表结构失败：${(e as Error).message}`)
  } finally {
    treeLoading.value = false
  }
}

function handleTreeSelect(keys: Array<string | number>): void {
  const key = String(keys[0] ?? '')
  if (key.startsWith('tb:')) {
    const [db, table] = key.slice(3).split('::')
    if (tree.value) emit('open-mapping', { cfg: tree.value.cfg, database: db, table })
  }
}

function isLeafNode(o: { isLeaf?: boolean }): boolean {
  return Boolean(o.isLeaf)
}

function onExpandedKeys(keys: Array<string | number>): void {
  expandedKeys.value = keys.map((k) => String(k))
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1 class="page-title">数据源管理</h1>
        <p class="page-sub">本地加密存储连接配置，数据不上传任何第三方服务</p>
      </div>
    </header>

    <n-card class="panel-card">
      <template #header>
        <div class="card-hd">
          <span>数据库（MySQL / PostgreSQL / SQL Server）</span>
          <n-button type="primary" size="small" @click="openDbForm()">+ 新增数据库</n-button>
        </div>
      </template>
      <n-data-table
        v-if="dbSources.length"
        :columns="dbColumns"
        :data="dbSources"
        :bordered="false"
        size="small"
        :loading="loading"
      />
      <n-empty v-else description="暂无数据库数据源，点击右上角新增" style="padding: 26px 0" />
    </n-card>

    <n-card v-if="tree" class="panel-card">
      <template #header>
        <div class="card-hd">
          <span>表结构 · {{ tree.cfg.name }}</span>
          <n-spin size="small" :show="treeLoading" />
        </div>
      </template>
      <n-tree
        block-line
        :data="treeOptions"
        :expanded-keys="expandedKeys"
        :default-expand-all="false"
        :selectable="isLeafNode"
        :show-line="true"
        :on-update:expanded-keys="onExpandedKeys"
        :on-update:selected-keys="handleTreeSelect"
      />
      <div v-if="tree.databases.length === 0" class="tree-tip">（未获取到数据库清单）</div>
    </n-card>

    <n-card class="panel-card">
      <template #header>
        <div class="card-hd">
          <span>Elasticsearch</span>
          <n-button type="warning" size="small" @click="openEsForm()">+ 新增 ES</n-button>
        </div>
      </template>
      <n-data-table
        v-if="esSources.length"
        :columns="esColumns"
        :data="esSources"
        :bordered="false"
        size="small"
        :loading="loading"
      />
      <n-empty v-else description="暂无 ES 数据源，点击右上角新增" style="padding: 26px 0" />
    </n-card>

    <n-modal
      v-model:show="modal.open"
      preset="card"
      :title="`${modal.editing ? '编辑' : '新增'}${modal.kind === 'db' ? '数据库' : 'ES 数据源'}`"
      style="width: 540px; max-width: 92vw"
    >
      <template v-if="modal.kind === 'db'">
        <n-grid :cols="2" :x-gap="14" :y-gap="4">
          <n-grid-item>
            <n-form-item label="名称"
              ><n-input v-model:value="dbForm.name" placeholder="如：本地开发库"
            /></n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="类型">
              <n-select v-model:value="dbForm.type" :options="DB_TYPE_LABELS" />
            </n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="Host"><n-input v-model:value="dbForm.host" /></n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="Port"
              ><n-input-number
                v-model:value="dbForm.port"
                :min="1"
                :max="65535"
                style="width: 100%"
            /></n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="用户名"><n-input v-model:value="dbForm.username" /></n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="密码">
              <n-input
                v-model:value="dbForm.password"
                type="password"
                show-password-on="click"
                :placeholder="modal.editing ? '留空表示保持不变' : ''"
              />
            </n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="默认数据库（可选）">
              <n-input v-model:value="dbForm.database" placeholder="留空连接后浏览全部库" />
            </n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="SSL（PG / SQL Server）">
              <n-switch v-model:value="dbForm.useSsl" />
            </n-form-item>
          </n-grid-item>
        </n-grid>
      </template>
      <template v-else>
        <n-grid :cols="2" :x-gap="14" :y-gap="4">
          <n-grid-item>
            <n-form-item label="名称"
              ><n-input v-model:value="esForm.name" placeholder="如：测试集群"
            /></n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="版本">
              <n-select
                v-model:value="esForm.version"
                :options="[
                  { label: 'ES 6（适配旧集群）', value: '6' },
                  { label: 'ES 7', value: '7' },
                  { label: 'ES 8+', value: '8' }
                ]"
              />
            </n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="Host"><n-input v-model:value="esForm.host" /></n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="Port"
              ><n-input-number
                v-model:value="esForm.port"
                :min="1"
                :max="65535"
                style="width: 100%"
            /></n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="安全连接（HTTPS）"
              ><n-switch v-model:value="esForm.secure"
            /></n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="用户名"><n-input v-model:value="esForm.username" /></n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="密码">
              <n-input
                v-model:value="esForm.password"
                type="password"
                show-password-on="click"
                :placeholder="modal.editing ? '留空表示保持不变' : ''"
              />
            </n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="API Key（可选，优先于账号密码）">
              <n-input v-model:value="esForm.apiKey" type="password" show-password-on="click" />
            </n-form-item>
          </n-grid-item>
        </n-grid>
      </template>
      <template #footer>
        <div class="modal-foot">
          <n-button @click="modal.open = false">取消</n-button>
          <n-button type="primary" :loading="testing" @click="testConnection">测试连接</n-button>
          <n-button type="primary" :loading="saving" @click="save">保存</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.page {
  max-width: 1120px;
}

.panel-card {
  margin-bottom: 16px;
}

.card-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.tree-tip {
  padding: 10px 4px;
  font-size: 12px;
  opacity: 0.5;
}

.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 8px;
}
</style>
