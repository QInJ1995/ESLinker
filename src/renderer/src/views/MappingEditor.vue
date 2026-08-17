<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue'
import type {
  DbConfig,
  EsConfig,
  MappingDocument,
  MappingField,
  MappingTemplate,
  TableMeta
} from '../lib/core'
import {
  ES_TYPE_OPTIONS,
  ANALYZER_OPTIONS,
  DATE_FORMAT_OPTIONS,
  DEFAULT_SETTINGS,
  uid,
  serialize
} from '../lib/core'

const props = defineProps<{
  tableContext: { cfg: DbConfig; database: string; table: string } | null
}>()
const emit = defineEmits<{ (e: 'snack', text: string, type?: string): void }>()

const mode = ref<'table' | 'ddl'>('table')
const loading = ref(false)
const meta = ref<TableMeta | null>(null)
const fields = ref<MappingField[]>([])
const settings = reactive({ ...DEFAULT_SETTINGS })
const settingsLoaded = ref(false)

const esSources = ref<EsConfig[]>([])
const esSourceId = ref('')
const esCfg = computed(() => esSources.value.find((s) => s.id === esSourceId.value) || null)
const indexName = ref('')
const indexExists = ref(false)
const checkingIndex = ref(false)

const doc = ref<MappingDocument | null>(null)
const previewOpen = ref(false)
const previewText = ref('')
const issues = ref<Array<{ field: string; level: 'error' | 'warning'; message: string }>>([])

const templates = ref<MappingTemplate[]>([])
const ddlText = ref('')
const parseInfo = ref('')

// ---------- 自定义字段 ----------
const CUSTOM_FIELD_PREFIX = 'custom_'

function isCustomField(column: string): boolean {
  return column.startsWith(CUSTOM_FIELD_PREFIX)
}

function addCustomField(): void {
  const id = uid()
  const column = `${CUSTOM_FIELD_PREFIX}${id}`
  const newField: MappingField = {
    column,
    field: `custom_field`,
    esType: 'keyword',
    addKeyword: false,
    indexable: true,
    analyzed: false,
    analyzer: 'standard',
    comment: '自定义字段'
  }
  allFieldsSnapshot.value.push(newField)
  fields.value.push(JSON.parse(JSON.stringify(newField)))
  void schedulePreview()
}

function removeCustomField(column: string): void {
  const snapIdx = allFieldsSnapshot.value.findIndex((f) => f.column === column)
  if (snapIdx >= 0) {
    allFieldsSnapshot.value.splice(snapIdx, 1)
  }
  const fieldIdx = fields.value.findIndex((f) => f.column === column)
  if (fieldIdx >= 0) {
    fields.value.splice(fieldIdx, 1)
  }
  void schedulePreview()
}

function resetCustomField(f: MappingField): void {
  f.field = 'custom_field'
  f.esType = 'keyword'
  f.addKeyword = false
  f.indexable = true
  f.analyzed = false
  f.analyzer = 'standard'
  f.scalingFactor = undefined
  f.format = undefined
  f.comment = '自定义字段'
}

// ---------- 字段选择（表格最左列，控制是否加入 Mapping） ----------
// 全量字段快照：永远保存表结构所有列，方便用户「加回」之前取消的列
const allFieldsSnapshot = ref<MappingField[]>([])

const allIncluded = computed(() => {
  const dbFields = allFieldsSnapshot.value.filter((f) => !isCustomField(f.column))
  const dbFieldsIncluded = fields.value.filter((f) => !isCustomField(f.column))
  return dbFields.length > 0 && dbFieldsIncluded.length === dbFields.length
})

function isIncluded(column: string): boolean {
  if (isCustomField(column)) return true
  return fields.value.some((f) => f.column === column)
}

function toggleInclude(column: string): void {
  if (isCustomField(column)) return
  const idx = fields.value.findIndex((f) => f.column === column)
  if (idx >= 0) {
    fields.value.splice(idx, 1)
  } else {
    const snap = allFieldsSnapshot.value.find((f) => f.column === column)
    if (!snap) return
    // 插入到与 snapshot 相同的顺序位置
    const order = allFieldsSnapshot.value.map((f) => f.column)
    const copy: MappingField = JSON.parse(JSON.stringify(snap))
    // 如果用户之前改过这个字段（在 template/full snapshot 中没记录），这里取 snapshot 的初始化值
    // 我们需要从全量快照的顺序找插入点
    const insertAt = order.indexOf(column)
    const fieldsOrder = fields.value.map((f) => order.indexOf(f.column))
    let pos = fields.value.length
    for (let i = 0; i < fieldsOrder.length; i++) {
      if (fieldsOrder[i] > insertAt) {
        pos = i
        break
      }
    }
    fields.value.splice(pos, 0, copy)
  }
  void schedulePreview()
}

function toggleIncludeAll(): void {
  // 获取所有自定义字段（保留）
  const customFields = fields.value.filter((f) => isCustomField(f.column))
  const customFieldsInSnapshot = allFieldsSnapshot.value.filter((f) => isCustomField(f.column))

  if (allIncluded.value) {
    // 全部取消（只取消库字段，保留自定义字段）
    fields.value = [...customFields]
  } else {
    // 全选：恢复快照里的所有库列，保留用户已修改过的字段，同时保留自定义字段
    const currentMap = new Map(fields.value.map((f) => [f.column, f]))
    const order = allFieldsSnapshot.value.map((f) => f.column)
    const dbSnapshots = allFieldsSnapshot.value.filter((f) => !isCustomField(f.column))
    const nextDbFields: MappingField[] = dbSnapshots.map((snap) => {
      const cur = currentMap.get(snap.column)
      const base: MappingField = cur ? cur : JSON.parse(JSON.stringify(snap))
      return base
    })
    // 合并自定义字段（优先从 fields 中取已修改的，否则从 snapshot 取）
    const mergedCustomFields = customFieldsInSnapshot.map((snap) => {
      const cur = currentMap.get(snap.column)
      return cur ? cur : JSON.parse(JSON.stringify(snap))
    })
    const next: MappingField[] = [...nextDbFields, ...mergedCustomFields]
    // 按 snapshot 顺序排序
    next.sort((a, b) => order.indexOf(a.column) - order.indexOf(b.column))
    fields.value = next
  }
  void schedulePreview()
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null

onMounted(async () => {
  try {
    const s = await window.api.settings.get()
    Object.assign(settings, s)
    settingsLoaded.value = true
  } catch {
    Object.assign(settings, DEFAULT_SETTINGS)
  }
  await loadTemplates()
  await loadEsSources()
})

watch(
  () => props.tableContext,
  async (ctx) => {
    if (ctx) {
      mode.value = 'table'
      await loadStructure(ctx.cfg, ctx.database, ctx.table)
    }
  },
  { immediate: true }
)

watch(fields, () => schedulePreview(), { deep: true })

async function loadEsSources(): Promise<void> {
  try {
    const items = await window.api.datasource.list()
    esSources.value = items.filter((i) => i.kind === 'es').map((i) => i.es!)
    if (esSources.value.length > 0 && !esSourceId.value) {
      esSourceId.value = esSources.value[0].id
    }
  } catch (e) {
    emit('snack', String((e as Error).message), 'error')
  }
}

async function loadTemplates(): Promise<void> {
  templates.value = await window.api.templates.list()
}

async function loadStructure(cfg: DbConfig, database: string, table: string): Promise<void> {
  loading.value = true
  indexExists.value = false
  try {
    // 保存现有的自定义字段
    const existingCustomFields = allFieldsSnapshot.value.filter((f) => isCustomField(f.column))
    const existingCustomFieldsMap = new Map(
      fields.value.filter((f) => isCustomField(f.column)).map((f) => [f.column, f])
    )

    meta.value = await window.api.datasource.structure(serialize(cfg), database, table)
    console.log(meta.value)
    if (!indexName.value) indexName.value = table
    const generatedFields = await window.api.mapping.generate(
      serialize(meta.value),
      serialize(settings)
    )
    // 合并自定义字段（保留用户修改）
    const mergedCustomFields = existingCustomFields.map((snap) => {
      const cur = existingCustomFieldsMap.get(snap.column)
      return cur ? cur : JSON.parse(JSON.stringify(snap))
    })
    fields.value = [...generatedFields, ...mergedCustomFields]
    allFieldsSnapshot.value = [
      ...JSON.parse(JSON.stringify(generatedFields)),
      ...existingCustomFields
    ]
    await schedulePreview()
  } catch (e) {
    emit('snack', `读取表结构失败：${(e as Error).message}`, 'error')
  } finally {
    loading.value = false
  }
}

async function regenerate(): Promise<void> {
  if (!meta.value) return
  // 保存现有的自定义字段
  const existingCustomFields = allFieldsSnapshot.value.filter((f) => isCustomField(f.column))
  const existingCustomFieldsMap = new Map(
    fields.value.filter((f) => isCustomField(f.column)).map((f) => [f.column, f])
  )

  const generatedFields = await window.api.mapping.generate(meta.value, serialize(settings))
  // 合并自定义字段（保留用户修改）
  const mergedCustomFields = existingCustomFields.map((snap) => {
    const cur = existingCustomFieldsMap.get(snap.column)
    return cur ? cur : JSON.parse(JSON.stringify(snap))
  })
  fields.value = [...generatedFields, ...mergedCustomFields]
  allFieldsSnapshot.value = [
    ...JSON.parse(JSON.stringify(generatedFields)),
    ...existingCustomFields
  ]
  emit('snack', '已按默认规则重新生成（自定义字段已保留）')
  await schedulePreview()
}

function resetRow(f: MappingField): void {
  const col = meta.value?.columns.find((c) => c.name === f.column)
  if (!col) return
  f.field = col.name
  f.esType = 'text'
  f.addKeyword = true
  f.indexable = true
  f.analyzed = false
  f.analyzer = 'standard'
  f.scalingFactor = undefined
  f.format = undefined
  if (col.primaryKey) {
    f.esType = 'keyword'
    f.addKeyword = false
  }
}

async function schedulePreview(): Promise<void> {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(async () => {
    await buildDoc()
  }, 400)
}

async function buildDoc(): Promise<void> {
  if (fields.value.length === 0) return
  try {
    doc.value = (await window.api.mapping.document(
      serialize(fields.value),
      serialize(settings)
    )) as MappingDocument
    previewText.value = JSON.stringify(doc.value, null, 2)
    issues.value = (await window.api.mapping.validate(
      serialize(fields.value)
    )) as typeof issues.value
  } catch (e) {
    emit('snack', String((e as Error).message), 'error')
  }
}

function openPreview(): void {
  previewOpen.value = true
  void buildDoc()
}

async function checkExists(): Promise<void> {
  if (!esCfg.value || !indexName.value) {
    emit('snack', '请先选择 ES 数据源并填写索引名')
    return
  }
  checkingIndex.value = true
  try {
    indexExists.value = await window.api.es.exists(serialize(esCfg.value), indexName.value)
    emit(
      'snack',
      indexExists.value
        ? `索引 ${indexName.value} 已存在`
        : `索引 ${indexName.value} 不存在，可直接创建`,
      indexExists.value ? 'info' : 'success'
    )
  } catch (e) {
    emit('snack', `检查失败：${(e as Error).message}`, 'error')
  } finally {
    checkingIndex.value = false
  }
}

async function createIndex(): Promise<void> {
  if (!esCfg.value || !indexName.value) {
    emit('snack', '请先选择 ES 数据源并填写索引名')
    return
  }
  await buildDoc()
  if (!doc.value) return
  const errors = issues.value.filter((i) => i.level === 'error')
  if (errors.length > 0) {
    emit('snack', `Mapping 校验未通过（${errors.length} 个错误），请先修正`, 'error')
    return
  }
  let overwrite = false
  try {
    const exists = await window.api.es.exists(serialize(esCfg.value), indexName.value)
    if (exists) {
      if (
        !window.confirm(
          `索引「${indexName.value}」已存在。创建将删除并重建索引（原有数据会丢失），是否继续？`
        )
      ) {
        emit('snack', '已取消（防覆盖保护）')
        return
      }
      overwrite = true
    }
    const res = (await window.api.es.create(
      serialize(esCfg.value),
      indexName.value,
      serialize(doc.value),
      overwrite
    )) as {
      created: boolean
      existed: boolean
    }
    emit(
      'snack',
      res.created ? `索引「${indexName.value}」创建成功` : '索引已存在，未覆盖',
      'success'
    )
    indexExists.value = true
  } catch (e) {
    emit('snack', `创建失败：${(e as Error).message}`, 'error')
  }
}

async function updateMapping(): Promise<void> {
  if (!esCfg.value || !indexName.value || !doc.value) return
  try {
    await window.api.es.update(
      serialize(esCfg.value),
      indexName.value,
      serialize(doc.value.mappings.properties)
    )
    emit('snack', 'Mapping 已推送更新', 'success')
  } catch (e) {
    emit('snack', `更新失败：${(e as Error).message}`, 'error')
  }
}

async function exportJson(): Promise<void> {
  if (!doc.value || !indexName.value) return
  await buildDoc()
  if (!doc.value) return
  const path = await window.api.es.export(serialize(doc.value), `${indexName.value}.mapping.json`)
  emit('snack', path ? `已导出：${path}` : '已取消导出', path ? 'success' : 'info')
}

async function saveTemplate(): Promise<void> {
  const name = window.prompt('模板名称')
  if (!name) return
  const tpl: MappingTemplate = {
    id: uid(),
    name,
    createdAt: new Date().toISOString(),
    fields: JSON.parse(JSON.stringify(fields.value))
  }
  await window.api.templates.save(serialize(tpl))
  await loadTemplates()
  emit('snack', '模板已保存', 'success')
}

async function applyTemplate(id: string): Promise<void> {
  const tpl = templates.value.find((t) => t.id === id)
  if (!tpl) return
  fields.value = JSON.parse(JSON.stringify(tpl.fields))
  emit('snack', `已应用模板「${tpl.name}」`)
  await schedulePreview()
}

async function removeTemplate(id: string): Promise<void> {
  await window.api.templates.remove(id)
  await loadTemplates()
}

async function applySettingDefaults(): Promise<void> {
  Object.assign(settings, await window.api.settings.get())
  emit('snack', '已加载全局默认映射规则')
  await regenerate()
}

// ---------- DDL offline mode ----------
async function parseDdl(): Promise<void> {
  if (!ddlText.value.trim()) return
  try {
    // 保存现有的自定义字段
    const existingCustomFields = allFieldsSnapshot.value.filter((f) => isCustomField(f.column))
    const existingCustomFieldsMap = new Map(
      fields.value.filter((f) => isCustomField(f.column)).map((f) => [f.column, f])
    )

    const m = await window.api.mapping.parseDDL(ddlText.value)
    if (!m) {
      parseInfo.value = '未能解析 DDL，请粘贴完整 CREATE TABLE 语句'
      return
    }
    mode.value = 'ddl'
    meta.value = m
    if (!indexName.value) indexName.value = m.table
    const generatedFields = await window.api.mapping.generate(m, serialize(settings))
    // 合并自定义字段（保留用户修改）
    const mergedCustomFields = existingCustomFields.map((snap) => {
      const cur = existingCustomFieldsMap.get(snap.column)
      return cur ? cur : JSON.parse(JSON.stringify(snap))
    })
    fields.value = [...generatedFields, ...mergedCustomFields]
    allFieldsSnapshot.value = [
      ...JSON.parse(JSON.stringify(generatedFields)),
      ...existingCustomFields
    ]
    parseInfo.value = `已解析 ${m.table} · ${m.columns.length} 列`
    await schedulePreview()
  } catch (e) {
    parseInfo.value = `解析失败：${(e as Error).message}`
  }
}

function switchTableMode(): void {
  if (mode.value === 'table') return
  mode.value = 'table'
  const ctx = props.tableContext
  if (ctx) {
    void loadStructure(ctx.cfg, ctx.database, ctx.table)
  } else {
    meta.value = null
  }
}

function switchDdlMode(): void {
  if (mode.value === 'ddl') return
  mode.value = 'ddl'
  meta.value = null
  parseInfo.value = ''
}

function fieldTypeChanged(f: MappingField): void {
  if (f.esType === 'scaled_float') {
    f.scalingFactor = f.scalingFactor || 100
  }
  if (f.esType !== 'date') f.format = undefined
  if (f.esType !== 'text') {
    f.analyzer = 'standard'
    f.analyzed = false
    f.addKeyword = false
  }
}

function analyzerChanged(f: MappingField): void {
  // 选择了非 standard 分词器时，自动开启 analyzed（分词模式）
  if (f.analyzer && f.analyzer !== 'standard') {
    f.analyzed = true
  } else {
    f.analyzed = false
  }
}

function short(df: string): string {
  return df.length > 40 ? df.slice(0, 40) + '…' : df
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>Mapping 编辑器</h1>
      <div class="head-tools">
        <div v-if="meta && mode === 'table'" class="meta-chip">
          表：{{ meta.database }}.{{ meta.table }}
          <span class="muted">
            · {{ meta.columns.length }} 列 · 主键 {{ meta.primaryKey || '无' }}
          </span>
        </div>
        <button class="btn ghost" :class="{ active: mode === 'table' }" @click="switchTableMode">
          数据库表
        </button>
        <button class="btn ghost" :class="{ active: mode === 'ddl' }" @click="switchDdlMode">
          DDL 离线
        </button>
      </div>
    </header>

    <!-- DDL offline panel -->
    <section v-if="mode === 'ddl' && !meta" class="panel ddl-panel">
      <div class="panel-head">
        <h2>粘贴 CREATE TABLE，离线生成 Mapping</h2>
      </div>
      <textarea
        v-model="ddlText"
        class="ddl-text"
        placeholder="CREATE TABLE `user` (\n  `id` bigint NOT NULL AUTO_INCREMENT,\n  `name` varchar(64) COMMENT '姓名',\n  ...\n) ENGINE=InnoDB COMMENT='用户表';"
      >
      </textarea>
      <div class="row-end">
        <span class="muted">{{ parseInfo }}</span>
        <button class="btn primary" @click="parseDdl">解析并生成</button>
      </div>
    </section>

    <section v-if="mode === 'table' && !props.tableContext && !meta" class="panel ddl-panel">
      <div class="empty2">
        <p>请到「数据源」中点击某个表的「表结构」，或使用 DDL 离线模式。</p>
        <button class="btn ghost" @click="switchDdlMode">去 DDL 离线生成</button>
      </div>
    </section>

    <template v-if="meta">
      <section class="panel">
        <div class="panel-head">
          <h2>
            字段映射
            <span class="muted small">规则已按默认规范自动生成，可逐行修改或重置</span>
          </h2>
          <div>
            <button class="btn primary" @click="addCustomField">新增自定义字段</button>
            <button class="btn" @click="regenerate">按规则重置</button>
            <button class="btn" @click="applySettingDefaults">载入全局规则</button>
            <button class="btn" @click="openPreview">预览 JSON</button>
          </div>
        </div>

        <div class="tbl-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th class="col-sel">
                  <input type="checkbox" :checked="allIncluded" @change="toggleIncludeAll" />
                </th>
                <th class="col-col">原库字段</th>
                <th class="col-raw">原类型</th>
                <th class="col-es">ES 类型</th>
                <th class="col-fld">ES 字段名</th>
                <th class="col-sub">keyword 子字段</th>
                <th class="col-idx">索引</th>
                <th class="col-an">分词器</th>
                <th class="col-cfg">额外配置</th>
                <th class="col-cmt">备注</th>
                <th class="col-rst"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="snap in allFieldsSnapshot"
                :key="snap.column"
                :class="{
                  'row-excluded': !isIncluded(snap.column),
                  'custom-row': isCustomField(snap.column)
                }"
              >
                <td class="col-sel">
                  <input
                    v-if="!isCustomField(snap.column)"
                    type="checkbox"
                    :checked="isIncluded(snap.column)"
                    @change="toggleInclude(snap.column)"
                  />
                  <span v-else class="custom-check-placeholder"></span>
                </td>
                <template v-if="isIncluded(snap.column) || isCustomField(snap.column)">
                  <td class="col-col">
                    <template v-if="isCustomField(snap.column)">
                      <span class="custom-badge">自定义</span>
                    </template>
                    <template v-else>
                      <span
                        v-if="meta.columns.find((c) => c.name === snap.column)?.primaryKey"
                        class="pk-badge"
                        >PK</span
                      >
                      <b>{{ snap.column }}</b>
                    </template>
                  </td>
                  <td class="mono raw">
                    <template v-if="isCustomField(snap.column)">
                      <span class="muted">—</span>
                    </template>
                    <template v-else>
                      {{ meta.columns.find((c) => c.name === snap.column)?.rawType || '-' }}
                    </template>
                  </td>
                  <template
                    v-for="renderF in [fields.find((x) => x.column === snap.column)!]"
                    :key="renderF.column"
                  >
                    <td>
                      <select
                        v-model="renderF.esType"
                        class="es-type"
                        @change="fieldTypeChanged(renderF)"
                      >
                        <option v-for="t in ES_TYPE_OPTIONS" :key="t" :value="t">{{ t }}</option>
                      </select>
                    </td>
                    <td><input v-model="renderF.field" class="fld" type="text" /></td>
                    <td>
                      <input
                        v-model="renderF.addKeyword"
                        type="checkbox"
                        :disabled="renderF.esType !== 'text'"
                      />
                    </td>
                    <td><input v-model="renderF.indexable" type="checkbox" /></td>
                    <td>
                      <select
                        v-model="renderF.analyzer"
                        :disabled="renderF.esType !== 'text'"
                        @change="analyzerChanged(renderF)"
                      >
                        <option v-for="a in ANALYZER_OPTIONS" :key="a" :value="a">{{ a }}</option>
                      </select>
                    </td>
                    <td>
                      <template v-if="renderF.esType === 'scaled_float'">
                        <span class="mini-label">scaling</span>
                        <input v-model.number="renderF.scalingFactor" class="mini" type="number" />
                      </template>
                      <template v-else-if="renderF.esType === 'date'">
                        <select v-model="renderF.format" class="mini-date">
                          <option v-for="df in DATE_FORMAT_OPTIONS" :key="df" :value="df">
                            {{ short(df) }}
                          </option>
                        </select>
                      </template>
                      <template v-else>
                        <span class="muted">—</span>
                      </template>
                    </td>
                    <td><input v-model="renderF.comment" class="cmt" type="text" /></td>
                    <td class="col-rst">
                      <template v-if="isCustomField(snap.column)">
                        <button
                          class="btn mini-btn danger-ghost"
                          @click="removeCustomField(snap.column)"
                        >
                          删除
                        </button>
                        <button class="btn mini-btn" @click="resetCustomField(renderF)">
                          重置
                        </button>
                      </template>
                      <template v-else>
                        <button class="btn mini-btn" @click="resetRow(renderF)">重置</button>
                      </template>
                    </td>
                  </template>
                </template>
                <template v-else>
                  <td class="col-col">
                    <span
                      v-if="meta.columns.find((c) => c.name === snap.column)?.primaryKey"
                      class="pk-badge"
                      >PK</span
                    >
                    <span class="excl-col">{{ snap.column }}</span>
                  </td>
                  <td class="mono raw excl">
                    {{ meta.columns.find((c) => c.name === snap.column)?.rawType || '-' }}
                  </td>
                  <td><span class="muted">—</span></td>
                  <td><span class="muted">—</span></td>
                  <td><span class="muted">—</span></td>
                  <td><span class="muted">—</span></td>
                  <td><span class="muted">—</span></td>
                  <td><span class="muted">—</span></td>
                  <td><span class="muted">—</span></td>
                  <td><span class="muted">—</span></td>
                </template>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="muted pick-tip-inline">
          共 {{ allFieldsSnapshot.filter((f) => !isCustomField(f.column)).length }} 个库字段 +
          {{ allFieldsSnapshot.filter((f) => isCustomField(f.column)).length }}
          个自定义字段。取消最左列勾选后，该库字段<strong>不会加入 Mapping，也不会同步到 ES</strong
          >。 当前包含：<b>{{ fields.length }}</b> 个字段
        </div>
        <div v-if="issues.length" class="issues">
          <div
            v-for="(it, idx) in issues"
            :key="idx"
            class="issue"
            :class="it.level === 'error' ? 'issue-err' : 'issue-warn'"
          >
            <b>{{ it.level === 'error' ? '✕' : '⚠' }}</b>
            <span class="mono">{{ it.field }}</span> · {{ it.message }}
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>ES 索引操作</h2>
          <div class="es-ops">
            <select v-model="esSourceId" class="es-sel">
              <option value="" disabled>选择 ES 数据源</option>
              <option v-for="s in esSources" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
            <input v-model="indexName" class="fld idx" type="text" placeholder="索引名称" />
            <button class="btn" :disabled="checkingIndex" @click="checkExists">
              {{ checkingIndex ? '检查中…' : '校验存在' }}
            </button>
            <button class="btn" @click="createIndex">创建/重建索引</button>
            <button class="btn" @click="updateMapping">推送 Mapping</button>
            <button class="btn" @click="exportJson">导出 JSON</button>
          </div>
        </div>
        <div class="muted">防覆盖保护：创建前自动校验，索引已存在时需二次确认。</div>
        <div class="es-badges">
          <span v-if="esCfg" class="badge badge-es"
            >目标：{{ esCfg.name }} ({{ esCfg.host }}:{{ esCfg.port }})</span
          >
          <span v-if="indexName" :class="indexExists ? 'badge badge-ok' : 'badge badge-muted'">
            {{ indexExists ? '索引已存在' : '索引不存在' }}
          </span>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>映射模板</h2>
          <button class="btn" @click="saveTemplate">保存当前为模板</button>
        </div>
        <div v-if="templates.length === 0" class="muted">暂无模板，保存常用字段映射以复用</div>
        <div v-else class="tpl-list">
          <div v-for="t in templates" :key="t.id" class="tpl-item">
            <span class="tpl-name">{{ t.name }}</span>
            <span class="muted"
              >{{ t.fields.length }} 字段 · {{ new Date(t.createdAt).toLocaleDateString() }}</span
            >
            <span class="tpl-ops">
              <button class="btn ghost" @click="applyTemplate(t.id)">应用</button>
              <button class="btn danger-ghost" @click="removeTemplate(t.id)">删除</button>
            </span>
          </div>
        </div>
      </section>
    </template>

    <div v-if="previewOpen" class="modal-mask" @click.self="previewOpen = false">
      <div class="modal wide">
        <div class="modal-head">
          <h3>Mapping JSON 预览</h3>
          <button class="btn ghost" @click="previewOpen = false">✕</button>
        </div>
        <div class="modal-body">
          <pre class="json-pre">{{ previewText || '生成中…' }}</pre>
        </div>
        <div class="modal-foot">
          <button class="btn" @click="exportJson">导出 JSON</button>
          <button class="btn primary" @click="previewOpen = false">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: 1240px;
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

.head-tools {
  display: flex;
  align-items: center;
  gap: 8px;
}

.meta-chip {
  font-size: 13px;
  color: var(--es-text-2);
  padding: 6px 12px;
  background: #eef2ff;
  border-radius: 20px;
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
  flex-wrap: wrap;
  gap: 10px;
}

.panel-head h2 {
  margin: 0;
  font-size: 15px;
}

.muted {
  color: var(--es-text-3);
}

.small {
  font-size: 12px;
  font-weight: 400;
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

.btn.ghost {
  border-color: transparent;
  background: transparent;
  color: var(--es-primary);
}

.btn.ghost.active {
  background: #eef2ff;
}

.btn.danger-ghost {
  border-color: transparent;
  background: transparent;
  color: var(--es-danger);
}

.btn.mini-btn {
  padding: 3px 8px;
  font-size: 11.5px;
}

.tbl-wrap {
  overflow: auto;
}

.grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  min-width: 1050px;
}

.grid th,
.grid td {
  padding: 7px 8px;
  border-bottom: 1px solid var(--es-border);
  text-align: left;
  vertical-align: middle;
}

.grid th {
  color: var(--es-text-3);
  font-weight: 500;
  font-size: 12px;
  white-space: nowrap;
}

.grid input,
.grid select {
  padding: 5px 7px;
  border: 1px solid var(--es-border);
  border-radius: 6px;
  font-size: 12.5px;
}

.grid input[type='checkbox'] {
  width: 15px;
  height: 15px;
}

.col-col {
  width: 130px;
}

.col-raw {
  width: 110px;
}

.col-es {
  width: 120px;
}

.col-fld {
  width: 140px;
}

.col-sub {
  width: 90px;
}

.col-idx {
  width: 60px;
}

.col-an {
  width: 120px;
}

.col-cfg {
  width: 150px;
}

.col-cmt {
  width: 180px;
}

.es-type,
.fld {
  width: 100%;
}

.mini {
  width: 70px;
}

.mini-date {
  width: 150px;
}

.cmt {
  width: 100%;
}

.pk-badge {
  background: #fee2e2;
  color: #b91c1c;
  border-radius: 4px;
  font-size: 10px;
  padding: 1px 4px;
  margin-right: 5px;
}

.raw {
  color: var(--es-text-3);
}

.mono {
  font-family: ui-monospace, Menlo, monospace;
}

.es-ops {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.es-sel {
  padding: 6px 8px;
  border: 1px solid var(--es-border);
  border-radius: 7px;
  min-width: 150px;
}

.idx {
  width: 180px;
}

.es-badges {
  margin-top: 10px;
  display: flex;
  gap: 8px;
}

.badge {
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 11.5px;
  font-weight: 600;
}

.badge-es {
  background: #fff7ed;
  color: #c2410c;
}

.badge-ok {
  background: #dcfce7;
  color: #15803d;
}

.badge-muted {
  background: #f1f5f9;
  color: #64748b;
}

.tpl-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tpl-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid var(--es-border);
  border-radius: 8px;
}

.tpl-name {
  font-weight: 600;
  flex: 1;
}

.tpl-ops {
  display: flex;
  gap: 4px;
}

.ddl-panel .ddl-text {
  width: 100%;
  min-height: 200px;
  border: 1px solid var(--es-border);
  border-radius: 8px;
  padding: 10px;
  font-family: ui-monospace, Menlo, monospace;
  font-size: 12.5px;
  resize: vertical;
}

.row-end {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
}

.empty2 {
  text-align: center;
  padding: 40px;
  color: var(--es-text-3);
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
  width: 560px;
  max-width: 92vw;
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
}

.modal.wide {
  width: 760px;
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

.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--es-border);
}

.json-pre {
  background: #0f172a;
  color: #cbd5e1;
  padding: 14px;
  border-radius: 8px;
  font-size: 12px;
  max-height: 460px;
  overflow: auto;
  white-space: pre;
  font-family: ui-monospace, Menlo, monospace;
}

.mini-label {
  font-size: 11px;
  color: var(--es-text-3);
  margin-right: 4px;
}

.issues {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.issue {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 7px;
  font-size: 12.5px;
}

.issue b {
  width: 16px;
}

.issue-err {
  background: #fef2f2;
  color: #b91c1c;
}

.issue-warn {
  background: #fffbeb;
  color: #a16207;
}

.modal-head-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pick-tip {
  margin-bottom: 12px;
  font-size: 12.5px;
}

.pick-tip code {
  font-family: ui-monospace, Menlo, monospace;
  background: #f1f5f9;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 11.5px;
}

.pick-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px 14px;
  max-height: 460px;
  overflow: auto;
  padding: 4px;
}

.pick-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid var(--es-border);
  border-radius: 6px;
  font-size: 12.5px;
  cursor: pointer;
}

.pick-item:hover {
  background: #f8fafc;
}

.pick-item input[type='checkbox'] {
  width: 15px;
  height: 15px;
}

.small {
  font-size: 11.5px;
}

.custom-row {
  background: #f0fdf4;
}

.custom-row:hover {
  background: #dcfce7;
}

.custom-badge {
  background: #dcfce7;
  color: #15803d;
  border-radius: 4px;
  font-size: 10px;
  padding: 1px 4px;
  margin-right: 5px;
  font-weight: 600;
}

.custom-check-placeholder {
  display: inline-block;
  width: 15px;
  height: 15px;
}

.row-excluded {
  opacity: 0.5;
}
</style>
