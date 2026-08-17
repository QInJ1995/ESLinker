<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, h } from 'vue'
import {
  NButton,
  NSpace,
  NInput,
  NInputNumber,
  NSelect,
  NSwitch,
  NCheckbox,
  NTag,
  NAlert,
  NEmpty,
  NDataTable
} from 'naive-ui'
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
import { message, confirmDanger } from '../lib/naive'

const props = defineProps<{
  tableContext: { cfg: DbConfig; database: string; table: string } | null
}>()

const mode = ref<'table' | 'ddl'>('table')
const loading = ref(false)
const meta = ref<TableMeta | null>(null)
const fields = ref<MappingField[]>([])
const settings = reactive({ ...DEFAULT_SETTINGS })

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

// ---------- 自定义字段 / 导入字段 ----------
const CUSTOM_FIELD_PREFIX = 'custom_'
const IMPORTED_FIELD_PREFIX = 'imported_'
const IMPORTED_FIELD_BADGE = '导入'

function isCustomField(column: string): boolean {
  return column.startsWith(CUSTOM_FIELD_PREFIX)
}

function isImportedField(column: string): boolean {
  return column.startsWith(IMPORTED_FIELD_PREFIX)
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
  gridVersion.value++
  void schedulePreview()
}

function removeCustomField(column: string): void {
  const snapIdx = allFieldsSnapshot.value.findIndex((f) => f.column === column)
  if (snapIdx >= 0) allFieldsSnapshot.value.splice(snapIdx, 1)
  const fieldIdx = fields.value.findIndex((f) => f.column === column)
  if (fieldIdx >= 0) fields.value.splice(fieldIdx, 1)
  gridVersion.value++
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

function resetImportedField(f: MappingField): void {
  f.esType = 'keyword'
  f.addKeyword = false
  f.indexable = true
  f.analyzed = false
  f.analyzer = 'standard'
  f.scalingFactor = undefined
  f.format = undefined
}

// ---------- 字段选择（表格最左列，控制是否加入 Mapping） ----------
const allFieldsSnapshot = ref<MappingField[]>([])
const gridVersion = ref(0)

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
    const order = allFieldsSnapshot.value.map((f) => f.column)
    const copy: MappingField = JSON.parse(JSON.stringify(snap))
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
  gridVersion.value++
  void schedulePreview()
}

function toggleIncludeAll(): void {
  const customFields = fields.value.filter((f) => isCustomField(f.column))
  const customFieldsInSnapshot = allFieldsSnapshot.value.filter((f) => isCustomField(f.column))

  if (allIncluded.value) {
    fields.value = [...customFields]
  } else {
    const currentMap = new Map(fields.value.map((f) => [f.column, f]))
    const order = allFieldsSnapshot.value.map((f) => f.column)
    const dbSnapshots = allFieldsSnapshot.value.filter((f) => !isCustomField(f.column))
    const nextDbFields: MappingField[] = dbSnapshots.map((snap) => {
      const cur = currentMap.get(snap.column)
      return cur ? cur : JSON.parse(JSON.stringify(snap))
    })
    const mergedCustomFields = customFieldsInSnapshot.map((snap) => {
      const cur = currentMap.get(snap.column)
      return cur ? cur : JSON.parse(JSON.stringify(snap))
    })
    const next: MappingField[] = [...nextDbFields, ...mergedCustomFields]
    next.sort((a, b) => order.indexOf(a.column) - order.indexOf(b.column))
    fields.value = next
  }
  gridVersion.value++
  void schedulePreview()
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null

onMounted(async () => {
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

const tableRows = computed(() => {
  void gridVersion.value
  return [...allFieldsSnapshot.value]
})

async function loadEsSources(): Promise<void> {
  try {
    const items = await window.api.datasource.list()
    esSources.value = items.filter((i) => i.kind === 'es').map((i) => i.es!)
    if (esSources.value.length > 0 && !esSourceId.value) {
      esSourceId.value = esSources.value[0].id
    }
  } catch (e) {
    message.error(String((e as Error).message))
  }
}

async function loadTemplates(): Promise<void> {
  templates.value = await window.api.templates.list()
}

async function loadStructure(cfg: DbConfig, database: string, table: string): Promise<void> {
  loading.value = true
  indexExists.value = false
  try {
    const customSnapshots = allFieldsSnapshot.value.filter((f) => isCustomField(f.column))
    const customMap = new Map(
      fields.value.filter((f) => isCustomField(f.column)).map((f) => [f.column, f])
    )

    meta.value = await window.api.datasource.structure(serialize(cfg), database, table)
    if (!indexName.value) indexName.value = table
    const generatedFields = await window.api.mapping.generate(
      serialize(meta.value),
      serialize(settings)
    )
    const mergedCustom = customSnapshots.map((snap) => {
      const cur = customMap.get(snap.column)
      return cur ? cur : JSON.parse(JSON.stringify(snap))
    })
    fields.value = [...generatedFields, ...mergedCustom]
    allFieldsSnapshot.value = [...JSON.parse(JSON.stringify(generatedFields)), ...customSnapshots]
    gridVersion.value++
    await schedulePreview()
  } catch (e) {
    message.error(`读取表结构失败：${(e as Error).message}`)
  } finally {
    loading.value = false
  }
}

async function regenerate(): Promise<void> {
  if (!meta.value) return
  const customSnapshots = allFieldsSnapshot.value.filter((f) => isCustomField(f.column))
  const customMap = new Map(
    fields.value.filter((f) => isCustomField(f.column)).map((f) => [f.column, f])
  )

  const generatedFields = await window.api.mapping.generate(meta.value, serialize(settings))
  const mergedCustom = customSnapshots.map((snap) => {
    const cur = customMap.get(snap.column)
    return cur ? cur : JSON.parse(JSON.stringify(snap))
  })
  fields.value = [...generatedFields, ...mergedCustom]
  allFieldsSnapshot.value = [...JSON.parse(JSON.stringify(generatedFields)), ...customSnapshots]
  gridVersion.value++
  message.success('已按默认规则重新生成（自定义字段已保留）')
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
    message.error(String((e as Error).message))
  }
}

function openPreview(): void {
  previewOpen.value = true
  void buildDoc()
}

async function checkExists(): Promise<void> {
  if (!esCfg.value || !indexName.value) {
    message.warning('请先选择 ES 数据源并填写索引名')
    return
  }
  checkingIndex.value = true
  try {
    indexExists.value = await window.api.es.exists(serialize(esCfg.value), indexName.value)
    message.success(
      indexExists.value
        ? `索引 ${indexName.value} 已存在`
        : `索引 ${indexName.value} 不存在，可直接创建`
    )
  } catch (e) {
    message.error(`检查失败：${(e as Error).message}`)
  } finally {
    checkingIndex.value = false
  }
}

async function createIndex(): Promise<void> {
  if (!esCfg.value || !indexName.value) {
    message.warning('请先选择 ES 数据源并填写索引名')
    return
  }
  await buildDoc()
  if (!doc.value) return
  const errors = issues.value.filter((i) => i.level === 'error')
  if (errors.length > 0) {
    message.error(`Mapping 校验未通过（${errors.length} 个错误），请先修正`)
    return
  }
  try {
    const exists = await window.api.es.exists(serialize(esCfg.value), indexName.value)
    if (exists) {
      confirmDanger(
        `索引「${indexName.value}」已存在。创建将删除并重建索引（原有数据会丢失），是否继续？`,
        () => {
          void doCreate(true)
        },
        {
          title: '防覆盖保护',
          positiveText: '删除并重建',
          onNegativeClick: () => message.info('已取消（防覆盖保护）')
        }
      )
      return
    }
    await doCreate(false)
  } catch (e) {
    message.error(`创建失败：${(e as Error).message}`)
  }
}

async function doCreate(overwrite: boolean): Promise<void> {
  try {
    if (!esCfg.value || !indexName.value || !doc.value) return
    const res = (await window.api.es.create(
      serialize(esCfg.value),
      indexName.value,
      serialize(doc.value),
      overwrite
    )) as { created: boolean; existed: boolean }
    message.success(res.created ? `索引「${indexName.value}」创建成功` : '索引已存在，未覆盖')
    indexExists.value = true
  } catch (e) {
    message.error(`创建失败：${(e as Error).message}`)
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
    message.success('Mapping 已推送更新')
  } catch (e) {
    message.error(`更新失败：${(e as Error).message}`)
  }
}

async function exportJson(): Promise<void> {
  if (!indexName.value) return
  await buildDoc()
  if (!doc.value) return
  const path = await window.api.es.export(serialize(doc.value), `${indexName.value}.mapping.json`)
  message.success(path ? `已导出：${path}` : '已取消导出')
}

// ---------- 模板 ----------
const tplModal = reactive({ open: false, name: '', description: '', shards: 1, replicas: 0 })

function openSaveTemplate(): void {
  tplModal.name = ''
  tplModal.description = ''
  tplModal.shards = settings.defaultShards
  tplModal.replicas = settings.defaultReplicas
  tplModal.open = true
}

async function saveTemplate(): Promise<void> {
  if (!tplModal.name.trim()) {
    message.warning('请输入模板名称')
    return
  }
  const tpl: MappingTemplate = {
    id: uid(),
    name: tplModal.name.trim(),
    description: tplModal.description.trim() || undefined,
    indexSettings: {
      number_of_shards: tplModal.shards,
      number_of_replicas: tplModal.replicas
    },
    createdAt: new Date().toISOString(),
    fields: JSON.parse(JSON.stringify(fields.value))
  }
  await window.api.templates.save(serialize(tpl))
  await loadTemplates()
  tplModal.open = false
  message.success('模板已保存')
}

async function applyTemplate(id: string): Promise<void> {
  const tpl = templates.value.find((t) => t.id === id)
  if (!tpl) return
  fields.value = JSON.parse(JSON.stringify(tpl.fields))
  allFieldsSnapshot.value = JSON.parse(JSON.stringify(tpl.fields))
  if (tpl.indexSettings?.number_of_shards != null)
    settings.defaultShards = tpl.indexSettings.number_of_shards
  if (tpl.indexSettings?.number_of_replicas != null)
    settings.defaultReplicas = tpl.indexSettings.number_of_replicas
  gridVersion.value++
  message.success(`已应用模板「${tpl.name}」`)
  await schedulePreview()
}

function removeTemplate(id: string): void {
  const tpl = templates.value.find((t) => t.id === id)
  confirmDanger(`删除模板「${tpl?.name ?? ''}」？`, async () => {
    await window.api.templates.remove(id)
    await loadTemplates()
    message.success('已删除')
  })
}

async function applySettingDefaults(): Promise<void> {
  Object.assign(settings, await window.api.settings.get())
  message.success('已加载全局默认映射规则')
  await regenerate()
}

// ---------- DDL offline mode ----------
async function parseDdl(): Promise<void> {
  if (!ddlText.value.trim()) return
  try {
    const customSnapshots = allFieldsSnapshot.value.filter((f) => isCustomField(f.column))
    const customMap = new Map(
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
    const mergedCustom = customSnapshots.map((snap) => {
      const cur = customMap.get(snap.column)
      return cur ? cur : JSON.parse(JSON.stringify(snap))
    })
    fields.value = [...generatedFields, ...mergedCustom]
    allFieldsSnapshot.value = [...JSON.parse(JSON.stringify(generatedFields)), ...customSnapshots]
    gridVersion.value++
    parseInfo.value = `已解析 ${m.table} · ${m.columns.length} 列`
    await schedulePreview()
  } catch (e) {
    parseInfo.value = `解析失败：${(e as Error).message}`
  }
}

// ---------- 导入 Mapping JSON ----------
async function importMappingFile(): Promise<void> {
  try {
    const result = await window.api.es.importMapping()
    if (!result) return
    const parsedFields = await window.api.mapping.parseDocument(serialize(result.doc))
    if (!parsedFields || parsedFields.length === 0) {
      message.error('未在 JSON 中找到有效的 Mapping 字段')
      return
    }
    const anyDoc = result.doc as {
      settings?: { number_of_shards?: number; number_of_replicas?: number }
    }
    if (anyDoc?.settings?.number_of_shards != null) {
      settings.defaultShards = anyDoc.settings.number_of_shards
    }
    if (anyDoc?.settings?.number_of_replicas != null) {
      settings.defaultReplicas = anyDoc.settings.number_of_replicas
    }

    const dbSnapshots = allFieldsSnapshot.value.filter(
      (f) => !isCustomField(f.column) && !isImportedField(f.column)
    )
    const dbMap = new Map(
      fields.value
        .filter((f) => !isCustomField(f.column) && !isImportedField(f.column))
        .map((f) => [f.column, f])
    )
    const customSnapshots = allFieldsSnapshot.value.filter((f) => isCustomField(f.column))
    const customMap = new Map(
      fields.value.filter((f) => isCustomField(f.column)).map((f) => [f.column, f])
    )
    const mergedDb = dbSnapshots.map((snap) => {
      const cur = dbMap.get(snap.column)
      return cur ? cur : JSON.parse(JSON.stringify(snap))
    })
    const mergedCustom = customSnapshots.map((snap) => {
      const cur = customMap.get(snap.column)
      return cur ? cur : JSON.parse(JSON.stringify(snap))
    })

    const prevMeta = meta.value
    const pathParts = result.path.split(/[\\/]/)
    const fileName = pathParts.pop() || 'imported'
    const baseName = fileName.replace(/\.mapping\.json$/, '').replace(/\.json$/, '')
    const importedColumns = parsedFields.map((f) => ({
      name: f.field,
      rawType: IMPORTED_FIELD_BADGE,
      dataType: 'imported',
      length: null,
      precision: null,
      scale: null,
      nullable: true,
      primaryKey: false,
      autoIncrement: false,
      default: null,
      comment: f.comment ?? null
    }))
    if (!prevMeta || prevMeta.database === 'imported') {
      meta.value = {
        database: 'imported',
        table: baseName,
        comment: `导入自 ${result.path}`,
        engine: null,
        columns: importedColumns,
        primaryKey: null,
        rowCount: parsedFields.length
      }
      if (!indexName.value) indexName.value = baseName
      fields.value = [...parsedFields, ...mergedCustom]
      allFieldsSnapshot.value = [...JSON.parse(JSON.stringify(parsedFields)), ...customSnapshots]
    } else {
      meta.value = {
        ...prevMeta,
        columns: [...prevMeta.columns, ...importedColumns]
      }
      fields.value = [...mergedDb, ...parsedFields, ...mergedCustom]
      allFieldsSnapshot.value = [
        ...dbSnapshots.map((s) => JSON.parse(JSON.stringify(s))),
        ...JSON.parse(JSON.stringify(parsedFields)),
        ...customSnapshots
      ]
    }

    mode.value = 'ddl'
    gridVersion.value++
    await schedulePreview()
    message.success(`已导入 ${parsedFields.length} 个字段（${baseName}）`)
  } catch (e) {
    message.error(`导入失败：${(e as Error).message}`)
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
  if (f.esType === 'scaled_float') f.scalingFactor = f.scalingFactor || 100
  if (f.esType !== 'date') f.format = undefined
  if (f.esType !== 'text') {
    f.analyzer = 'standard'
    f.analyzed = false
    f.addKeyword = false
  }
  void schedulePreview()
}

function analyzerChanged(f: MappingField): void {
  if (f.analyzer && f.analyzer !== 'standard') {
    f.analyzed = true
  } else {
    f.analyzed = false
  }
  void schedulePreview()
}

function short(df: string): string {
  return df.length > 40 ? df.slice(0, 40) + '…' : df
}

function renderFOf(row: MappingField): MappingField | null {
  if (isCustomField(row.column)) return row
  return fields.value.find((x) => x.column === row.column) || null
}

function rowCls(row: MappingField): string {
  if (!isIncluded(row.column)) return 'row-excluded'
  if (isCustomField(row.column)) return 'row-custom'
  if (isImportedField(row.column)) return 'row-imported'
  return ''
}

const typeOptions = ES_TYPE_OPTIONS.map((t) => ({ label: t, value: t }))
const analyzerOptions = ANALYZER_OPTIONS.map((a) => ({ label: a, value: a }))
const dateFormatOptions = DATE_FORMAT_OPTIONS.map((df) => ({ label: short(df), value: df }))

// ---- 数据表列定义 ----
const columns = computed(() => [
  {
    title: '',
    key: 'sel',
    width: 46,
    render: (row: MappingField) => {
      if (isCustomField(row.column)) return h('span')
      return h(NCheckbox, {
        checked: isIncluded(row.column),
        onUpdateChecked: () => toggleInclude(row.column)
      })
    }
  },
  {
    title: '原库字段',
    key: 'column',
    width: 170,
    render: (row: MappingField) => {
      if (isCustomField(row.column)) {
        return h(
          NSpace,
          { size: 6, align: 'center' },
          {
            default: () => [
              h(
                NTag,
                { size: 'small', type: 'success', bordered: false },
                { default: () => '自定义' }
              ),
              h('b', {}, row.field)
            ]
          }
        )
      }
      const pk = meta.value?.columns.find((c) => c.name === row.column)?.primaryKey
      return h(
        NSpace,
        { size: 6, align: 'center' },
        {
          default: () => [
            isImportedField(row.column)
              ? h(NTag, { size: 'small', type: 'info', bordered: false }, { default: () => '导入' })
              : pk
                ? h(
                    NTag,
                    { size: 'small', type: 'error', bordered: false },
                    { default: () => 'PK' }
                  )
                : null,
            h('b', {}, isImportedField(row.column) ? row.field : row.column)
          ]
        }
      )
    }
  },
  {
    title: '原类型',
    key: 'raw',
    width: 110,
    render: (row: MappingField) => {
      if (isCustomField(row.column)) return h('span', { class: 'muted' }, '—')
      if (isImportedField(row.column))
        return h('span', { class: 'mono', style: 'opacity:.7' }, row.esType)
      return h(
        'span',
        { class: 'mono', style: 'opacity:.7' },
        meta.value?.columns.find((c) => c.name === row.column)?.rawType || '-'
      )
    }
  },
  {
    title: 'ES 类型',
    key: 'esType',
    width: 130,
    render: (row: MappingField) => {
      const f = renderFOf(row)
      if (!f) return h('span', { class: 'muted' }, '—')
      return h(NSelect, {
        size: 'small',
        value: f.esType,
        options: typeOptions,
        onUpdateValue: (v: string) => {
          f.esType = v
          fieldTypeChanged(f)
        }
      })
    }
  },
  {
    title: 'ES 字段名',
    key: 'field',
    width: 150,
    render: (row: MappingField) => {
      const f = renderFOf(row)
      if (!f) return h('span', { class: 'muted' }, '—')
      return h(NInput, { size: 'small', value: f.field, onUpdateValue: (v) => (f.field = v) })
    }
  },
  {
    title: 'keyword 子字段',
    key: 'addKeyword',
    width: 90,
    render: (row: MappingField) => {
      const f = renderFOf(row)
      if (!f) return h('span', { class: 'muted' }, '—')
      return h(NSwitch, {
        size: 'small',
        value: f.addKeyword,
        disabled: f.esType !== 'text',
        onUpdateValue: (v: boolean) => {
          f.addKeyword = v
          void schedulePreview()
        }
      })
    }
  },
  {
    title: '索引',
    key: 'indexable',
    width: 68,
    render: (row: MappingField) => {
      const f = renderFOf(row)
      if (!f) return h('span', { class: 'muted' }, '—')
      return h(NSwitch, {
        size: 'small',
        value: f.indexable,
        onUpdateValue: (v: boolean) => {
          f.indexable = v
          void schedulePreview()
        }
      })
    }
  },
  {
    title: '分词器',
    key: 'analyzer',
    width: 130,
    render: (row: MappingField) => {
      const f = renderFOf(row)
      if (!f) return h('span', { class: 'muted' }, '—')
      return h(NSelect, {
        size: 'small',
        value: f.analyzer,
        options: analyzerOptions,
        disabled: f.esType !== 'text',
        onUpdateValue: (v: string) => {
          f.analyzer = v
          analyzerChanged(f)
        }
      })
    }
  },
  {
    title: '额外配置',
    key: 'extra',
    width: 170,
    render: (row: MappingField) => {
      const f = renderFOf(row)
      if (!f) return h('span', { class: 'muted' }, '—')
      if (f.esType === 'scaled_float') {
        return h(NInputNumber, {
          size: 'small',
          value: f.scalingFactor ?? 100,
          min: 1,
          onUpdateValue: (v) => (f.scalingFactor = v ?? 100)
        })
      }
      if (f.esType === 'date') {
        return h(NSelect, {
          size: 'small',
          value: f.format,
          options: dateFormatOptions,
          placeholder: '选择格式',
          onUpdateValue: (v) => (f.format = v)
        })
      }
      return h('span', { class: 'muted' }, '—')
    }
  },
  {
    title: '备注',
    key: 'comment',
    width: 170,
    render: (row: MappingField) => {
      const f = renderFOf(row)
      if (!f) return h('span', { class: 'muted' }, '—')
      return h(NInput, {
        size: 'small',
        value: f.comment ?? '',
        onUpdateValue: (v) => (f.comment = v)
      })
    }
  },
  {
    title: '',
    key: 'ops',
    width: 90,
    render: (row: MappingField) => {
      if (!isCustomField(row.column) && !isImportedField(row.column)) {
        const f = renderFOf(row)
        if (!f) return h('span')
        return h(
          NButton,
          { size: 'tiny', quaternary: true, onClick: () => resetRow(f) },
          { default: () => '重置' }
        )
      }
      const f = renderFOf(row) || row
      return h(
        NSpace,
        { size: 4 },
        {
          default: () => [
            h(
              NButton,
              { size: 'tiny', quaternary: true, onClick: () => removeCustomField(row.column) },
              { default: () => '删除' }
            ),
            h(
              NButton,
              {
                size: 'tiny',
                quaternary: true,
                onClick: () =>
                  isCustomField(row.column) ? resetCustomField(f) : resetImportedField(f)
              },
              { default: () => '重置' }
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
        <h1 class="page-title">Mapping 编辑器</h1>
        <p class="page-sub">
          <template v-if="meta && mode === 'table'">
            表：{{ meta.database }}.{{ meta.table }} · {{ meta.columns.length }} 列 · 主键
            {{ meta.primaryKey || '无' }}
          </template>
          <template v-else>自动类型映射 · 可视化编辑 · 一键建索引</template>
        </p>
      </div>
      <n-space>
        <n-button
          :type="mode === 'table' ? 'primary' : 'default'"
          size="small"
          @click="switchTableMode"
        >
          数据库表
        </n-button>
        <n-button
          :type="mode === 'ddl' ? 'primary' : 'default'"
          size="small"
          @click="switchDdlMode"
        >
          DDL 离线
        </n-button>
      </n-space>
    </header>

    <n-spin :show="loading">
      <!-- DDL offline panel -->
      <n-card v-if="mode === 'ddl' && !meta" class="panel-card">
        <template #header>粘贴 CREATE TABLE，离线生成 Mapping</template>
        <n-input
          v-model:value="ddlText"
          type="textarea"
          :autosize="{ minRows: 8, maxRows: 16 }"
          placeholder="CREATE TABLE `user` (\n  `id` bigint NOT NULL AUTO_INCREMENT,\n  `name` varchar(64) COMMENT '姓名',\n  ...\n) ENGINE=InnoDB COMMENT='用户表';"
          class="mono-input"
        />
        <div class="row-end">
          <span class="muted">{{ parseInfo }}</span>
          <n-button type="primary" @click="parseDdl">解析并生成</n-button>
        </div>
      </n-card>

      <n-card v-if="mode === 'table' && !props.tableContext && !meta" class="panel-card">
        <n-empty description="请到「数据源」点击某张表的「表结构」，或使用 DDL 离线模式">
          <template #extra>
            <n-button size="small" @click="switchDdlMode">去 DDL 离线生成</n-button>
          </template>
        </n-empty>
      </n-card>

      <template v-if="meta">
        <n-card class="panel-card">
          <template #header>
            <div class="card-hd">
              <span>字段映射</span>
              <n-space size="6">
                <n-button size="small" @click="importMappingFile">导入 JSON</n-button>
                <n-button size="small" type="primary" @click="addCustomField"
                  >新增自定义字段</n-button
                >
                <n-button size="small" @click="regenerate">按规则重置</n-button>
                <n-button size="small" @click="applySettingDefaults">载入全局规则</n-button>
                <n-button size="small" @click="openPreview">预览 JSON</n-button>
              </n-space>
            </div>
          </template>

          <div class="pick-tip">
            <n-space size="16" align="center">
              <n-checkbox :checked="allIncluded" @update:checked="toggleIncludeAll"
                >全选 / 全不选</n-checkbox
              >
              <span class="muted">
                共
                {{
                  allFieldsSnapshot.filter(
                    (f) => !isCustomField(f.column) && !isImportedField(f.column)
                  ).length
                }}
                个库字段 +
                {{ allFieldsSnapshot.filter((f) => isImportedField(f.column)).length }} 个导入字段 +
                {{ allFieldsSnapshot.filter((f) => isCustomField(f.column)).length }}
                个自定义字段；当前包含 <b>{{ fields.length }}</b> 个
              </span>
            </n-space>
          </div>

          <n-data-table
            :columns="columns"
            :data="tableRows"
            size="small"
            :bordered="false"
            :row-class-name="rowCls"
            :scroll-x="1220"
            :min-height="120"
          />

          <n-alert
            v-for="(it, idx) in issues"
            :key="idx"
            class="issue-alert"
            :type="it.level === 'error' ? 'error' : 'warning'"
            :show-icon="false"
          >
            <template #default>
              <b class="mono">{{ it.field }}</b> · {{ it.message }}
            </template>
          </n-alert>
        </n-card>

        <n-card class="panel-card">
          <template #header>ES 索引操作</template>
          <div class="es-ops">
            <n-select
              v-model:value="esSourceId"
              size="small"
              style="min-width: 180px"
              placeholder="选择 ES 数据源"
              :options="esSources.map((s) => ({ label: s.name, value: s.id }))"
            />
            <n-input
              v-model:value="indexName"
              size="small"
              style="width: 200px"
              placeholder="索引名称"
            />
            <n-button size="small" :loading="checkingIndex" @click="checkExists">校验存在</n-button>
            <n-button size="small" type="primary" @click="createIndex">创建/重建索引</n-button>
            <n-button size="small" @click="updateMapping">推送 Mapping</n-button>
            <n-button size="small" @click="exportJson">导出 JSON</n-button>
          </div>
          <div class="muted small-block">防覆盖保护：创建前自动校验，索引已存在时需二次确认。</div>
          <n-space size="8" class="es-badges">
            <n-tag v-if="esCfg" size="small" type="warning" bordered>
              目标：{{ esCfg.name }} ({{ esCfg.host }}:{{ esCfg.port }}) · ES {{ esCfg.version }}
            </n-tag>
            <n-tag
              v-if="indexName"
              size="small"
              :type="indexExists ? 'success' : 'default'"
              bordered
            >
              {{ indexExists ? '索引已存在' : '索引不存在' }}
            </n-tag>
          </n-space>
        </n-card>

        <n-card class="panel-card">
          <template #header>
            <div class="card-hd">
              <span>映射模板</span>
              <n-button size="small" type="primary" ghost @click="openSaveTemplate"
                >保存当前为模板</n-button
              >
            </div>
          </template>
          <n-empty
            v-if="templates.length === 0"
            description="暂无模板，保存常用字段映射以复用"
            style="padding: 14px 0"
          />
          <n-space v-else vertical :size="8">
            <n-space v-for="t in templates" :key="t.id" align="center" class="tpl-item">
              <b class="tpl-name">{{ t.name }}</b>
              <span class="muted">
                {{ t.fields.length }} 字段 · {{ new Date(t.createdAt).toLocaleDateString() }}
                <template v-if="t.indexSettings">
                  · {{ t.indexSettings.number_of_shards ?? '?' }}sh/
                  {{ t.indexSettings.number_of_replicas ?? '?' }}rep</template
                >
              </span>
              <template v-if="t.description">
                <n-tag size="small" type="info" bordered class="tpl-desc">{{
                  t.description
                }}</n-tag>
              </template>
              <span class="tpl-ops">
                <n-button size="tiny" type="primary" ghost @click="applyTemplate(t.id)"
                  >应用</n-button
                >
                <n-button size="tiny" type="error" ghost @click="removeTemplate(t.id)"
                  >删除</n-button
                >
              </span>
            </n-space>
          </n-space>
        </n-card>
      </template>
    </n-spin>

    <!-- Mapping JSON 预览 -->
    <n-modal
      v-model:show="previewOpen"
      preset="card"
      title="Mapping JSON 预览"
      style="width: 760px; max-width: 92vw"
    >
      <pre class="json-pre">{{ previewText || '生成中…' }}</pre>
      <template #footer>
        <div class="modal-foot">
          <n-button @click="exportJson">导出 JSON</n-button>
          <n-button type="primary" @click="previewOpen = false">关闭</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 保存模板 -->
    <n-modal
      v-model:show="tplModal.open"
      preset="card"
      title="保存为模板"
      style="width: 440px; max-width: 92vw"
    >
      <n-form label-placement="top">
        <n-form-item label="模板名称"
          ><n-input v-model:value="tplModal.name" placeholder="如：订单表高级模板"
        /></n-form-item>
        <n-form-item label="描述（业务特殊字段说明）"
          ><n-input
            v-model:value="tplModal.description"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 4 }"
        /></n-form-item>
        <n-form-item label="索引默认分片 / 副本（应用模板时生效）">
          <n-space size="8">
            <n-input-number
              v-model:value="tplModal.shards"
              :min="1"
              :max="32"
              style="width: 120px"
            />
            <n-input-number
              v-model:value="tplModal.replicas"
              :min="0"
              :max="4"
              style="width: 120px"
            />
          </n-space>
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="modal-foot">
          <n-button @click="tplModal.open = false">取消</n-button>
          <n-button type="primary" @click="saveTemplate">保存</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.page {
  max-width: 1280px;
}

.panel-card {
  margin-bottom: 16px;
}

.card-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  width: 100%;
}

.row-end {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}

.muted {
  font-size: 12px;
  opacity: 0.55;
}

.pick-tip {
  margin-bottom: 10px;
  font-size: 12.5px;
}

.small-block {
  margin-top: 10px;
}

.es-ops {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.es-badges {
  margin-top: 12px;
}

.issue-alert {
  margin-top: 10px;
}

.tpl-item {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid rgba(128, 128, 128, 0.18);
  border-radius: 8px;
  flex-wrap: wrap;
}

.tpl-name {
  flex: 1;
}

.tpl-desc {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tpl-ops {
  display: flex;
  gap: 4px;
}

.json-pre {
  background: #0f172a;
  color: #cbd5e1;
  padding: 14px;
  border-radius: 8px;
  font-size: 12px;
  max-height: 60vh;
  overflow: auto;
  white-space: pre;
  font-family: ui-monospace, Menlo, monospace;
}

.mono-input :deep(textarea) {
  font-family: ui-monospace, Menlo, monospace;
}

.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>

<style>
.n-data-table-td.row-excluded {
  opacity: 0.45;
}

.n-data-table-tr.row-custom {
  background: rgba(22, 163, 74, 0.07);
}

.n-data-table-tr.row-imported {
  background: rgba(37, 99, 235, 0.07);
}
</style>
