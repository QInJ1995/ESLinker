<script setup lang="ts">
import { ref, reactive, computed, onMounted, h } from 'vue'
import {
  NButton,
  NInput,
  NInputNumber,
  NSelect,
  NCard,
  NForm,
  NFormItem,
  NGrid,
  NGridItem,
  NDataTable,
  NEmpty,
  NStatistic,
  NAlert,
  NTag,
  NTooltip
} from 'naive-ui'
import type { CompareResult, DbConfig, EsConfig } from '../lib/core'
import { serialize } from '../lib/core'
import { message } from '../lib/naive'

const dbSources = ref<DbConfig[]>([])
const esSources = ref<EsConfig[]>([])
const treeData = reactive<{ databases: string[]; tables: Map<string, string[]> }>({
  databases: [],
  tables: new Map()
})

const form = reactive({
  dbSourceId: '',
  database: '',
  table: '',
  primaryKey: '',
  esSourceId: '',
  esIndex: '',
  rowLimit: 50000
})

const running = ref(false)
const result = ref<CompareResult | null>(null)

const dbSourceOptions = computed(() => dbSources.value.map((s) => ({ label: s.name, value: s.id })))
const esSourceOptions = computed(() => esSources.value.map((s) => ({ label: s.name, value: s.id })))
const dbOptions = computed(() => treeData.databases.map((d) => ({ label: d, value: d })))
const tableOptions = computed(() =>
  (treeData.tables.get(form.database) || []).map((t) => ({ label: t, value: t }))
)

onMounted(async () => {
  try {
    const items = await window.api.datasource.list()
    dbSources.value = items.filter((i) => i.kind === 'db').map((i) => i.db!)
    esSources.value = items.filter((i) => i.kind === 'es').map((i) => i.es!)
  } catch (e) {
    message.error(String((e as Error).message))
  }
})

async function onDbSourceChange(): Promise<void> {
  const cfg = dbSources.value.find((s) => s.id === form.dbSourceId)
  form.database = ''
  form.table = ''
  form.primaryKey = ''
  treeData.databases = []
  treeData.tables.clear()
  if (!cfg) return
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
  const cfg = dbSources.value.find((s) => s.id === form.dbSourceId)
  if (!cfg || !form.database || !form.table) return
  try {
    const meta = await window.api.datasource.structure(serialize(cfg), form.database, form.table)
    form.primaryKey = meta.primaryKey || ''
    if (!form.esIndex) form.esIndex = meta.table
    if (!meta.primaryKey) message.warning('该表未检测到主键，无法做逐行对比（可仅对比数量）')
  } catch (e) {
    message.error(String((e as Error).message))
  }
}

async function run(): Promise<void> {
  if (!form.dbSourceId || !form.database || !form.table || !form.esSourceId) {
    message.warning('请完整填写数据库 / 表 / ES 目标')
    return
  }
  if (!form.primaryKey) {
    message.warning('需要主键才能进行逐行对比')
    return
  }
  const db = dbSources.value.find((s) => s.id === form.dbSourceId)!
  const es = esSources.value.find((s) => s.id === form.esSourceId)!
  running.value = true
  result.value = null
  try {
    result.value = await window.api.compare.run({
      db: serialize(db),
      database: form.database,
      table: form.table,
      primaryKey: form.primaryKey,
      es: serialize(es),
      esIndex: form.esIndex || form.table,
      rowLimit: form.rowLimit
    })
    if (result.value.errors.length > 0) {
      message.error(result.value.errors[0])
    } else if (
      result.value.mismatch + result.value.missingInEs === 0 &&
      !result.value.limitReached
    ) {
      message.success('对比完成：完全一致')
    } else {
      message.info('对比完成，存在不一致，请查看下方明细')
    }
  } catch (e) {
    message.error(`对比失败：${(e as Error).message}`)
  } finally {
    running.value = false
  }
}

const mismatchColumns = computed(() => [
  {
    title: '主键',
    key: 'id',
    width: 160,
    render: (row: { id: string }) => h('span', { class: 'mono' }, row.id)
  },
  {
    title: '差异原因',
    key: 'reason',
    minWidth: 240,
    render: (row: { reason: string }) => h('span', { class: 'mono small' }, row.reason)
  },
  {
    title: '数据库值',
    key: 'db',
    minWidth: 220,
    render: (row: { db?: string }) =>
      row.db
        ? h(
            NTooltip,
            {},
            {
              trigger: () => h('span', { class: 'mono small truncate' }, row.db),
              default: () => row.db
            }
          )
        : h('span', { class: 'muted' }, '—')
  },
  {
    title: 'ES 值',
    key: 'es',
    minWidth: 220,
    render: (row: { es?: string }) =>
      row.es
        ? h(
            NTooltip,
            {},
            {
              trigger: () => h('span', { class: 'mono small truncate' }, row.es),
              default: () => row.es
            }
          )
        : h('span', { class: 'muted' }, '—')
  }
])

const missingSample = computed(() => (result.value?.missingInEsSample || []).map((id) => ({ id })))

const missingColumns = computed(() => [
  {
    title: '主键（数据库中缺失对应 ES 文档）',
    key: 'id',
    render: (r: { id: string }) => h('span', { class: 'mono' }, r.id)
  }
])
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1 class="page-title">数据对比校验</h1>
        <p class="page-sub">
          以主键值为 ES `_id`，逐行核对数据库表与 ES 索引内容是否一致（字段重命名需在 Mapping
          中保持一致）
        </p>
      </div>
    </header>

    <n-card class="panel-card" title="对比参数">
      <n-form label-placement="top" :show-feedback="false">
        <n-grid :cols="4" :x-gap="14" :y-gap="0" responsive="screen" item-responsive>
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
            <n-form-item label="主键字段">
              <n-input v-model:value="form.primaryKey" placeholder="自动检测" />
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
            <n-form-item label="ES 索引">
              <n-input v-model:value="form.esIndex" placeholder="自动填表名" />
            </n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="最多比对行数">
              <n-input-number
                v-model:value="form.rowLimit"
                :min="100"
                :step="1000"
                :max="500000"
                style="width: 100%"
              />
            </n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label=" ">
              <n-button type="primary" :loading="running" @click="run">开始对比</n-button>
            </n-form-item>
          </n-grid-item>
        </n-grid>
      </n-form>
    </n-card>

    <template v-if="result">
      <n-alert v-if="result.errors.length" type="error" :bordered="false" class="panel-card">
        {{ result.errors.join('；') }}
      </n-alert>
      <n-alert v-else-if="result.limitReached" type="warning" :bordered="false" class="panel-card">
        已达到比对行数上限（{{ result.scanned.toLocaleString() }}
        行），如需全量对比请增大「最多比对行数」。
      </n-alert>

      <n-grid
        :cols="5"
        :x-gap="12"
        :y-gap="12"
        responsive="screen"
        item-responsive
        class="panel-card"
      >
        <n-grid-item
          ><n-card><n-statistic label="数据库行数" :value="result.dbCount" /></n-card
        ></n-grid-item>
        <n-grid-item
          ><n-card><n-statistic label="ES 文档数" :value="result.esCount" /></n-card
        ></n-grid-item>
        <n-grid-item
          ><n-card><n-statistic label="已扫描" :value="result.scanned" /></n-card
        ></n-grid-item>
        <n-grid-item
          ><n-card
            ><n-statistic label="一致" :value="result.matched"
              ><template #suffix
                ><n-tag size="small" type="success" :bordered="false">OK</n-tag></template
              ></n-statistic
            ></n-card
          ></n-grid-item
        >
        <n-grid-item
          ><n-card><n-statistic label="不一致" :value="result.mismatch" /></n-card
        ></n-grid-item>
        <n-grid-item
          ><n-card><n-statistic label="ES 缺失" :value="result.missingInEs" /></n-card
        ></n-grid-item>
        <n-grid-item
          ><n-card><n-statistic label="ES 多余（近似）" :value="result.extraInEs" /></n-card
        ></n-grid-item>
        <n-grid-item
          ><n-card
            ><n-statistic
              label="耗时"
              :value="`${(result.elapsedMs / 1000).toFixed(1)}s`" /></n-card
        ></n-grid-item>
      </n-grid>

      <n-card class="panel-card" title="不一致明细">
        <n-data-table
          v-if="result.mismatchSample.length"
          :columns="mismatchColumns"
          :data="result.mismatchSample"
          :bordered="false"
          size="small"
          :scroll-x="900"
        />
        <n-empty v-else description="无内容不一致" style="padding: 18px 0" />
      </n-card>

      <n-card class="panel-card" title="ES 缺失文档（前 20 条）">
        <n-data-table
          v-if="missingSample.length"
          :columns="missingColumns"
          :data="missingSample"
          :bordered="false"
          size="small"
        />
        <n-empty v-else description="无缺失" style="padding: 18px 0" />
      </n-card>
    </template>

    <n-empty v-else description="选择数据源并点击「开始对比」" style="padding: 40px 0" />
  </div>
</template>

<style scoped>
.page {
  max-width: 1180px;
}

.panel-card {
  margin-bottom: 16px;
}

.small {
  font-size: 12px;
}

.truncate {
  display: inline-block;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}

.muted {
  opacity: 0.5;
}
</style>
