import {
  ColumnMeta,
  MappingDocument,
  MappingField,
  MappingRuleOptions,
  Settings,
  TableMeta,
  DEFAULT_SETTINGS
} from './types'

const STRING_TYPES: Record<string, boolean> = {
  char: true,
  varchar: true,
  text: true,
  tinytext: true,
  mediumtext: true,
  longtext: true,
  nchar: true,
  nvarchar: true,
  ntext: true,
  citext: true,
  character: true,
  'character varying': true,
  uuid: true,
  enum: true,
  set: true
}

const TEXT_ONLY_TYPES: Record<string, boolean> = {
  text: true,
  tinytext: true,
  mediumtext: true,
  longtext: true,
  ntext: true,
  json: true,
  jsonb: true
}

const INTEGER_TYPES: Record<string, string> = {
  tinyint: 'integer',
  smallint: 'integer',
  mediumint: 'integer',
  int: 'integer',
  integer: 'integer',
  int4: 'integer',
  int2: 'integer',
  serial: 'integer',
  bigint: 'long',
  int8: 'long',
  bigserial: 'long',
  long: 'long',
  largeint: 'long',
  unsigned: 'long'
}

const FLOAT_TYPES: Record<string, string> = {
  float: 'float',
  real: 'float',
  float4: 'float',
  double: 'double',
  'double precision': 'double',
  float8: 'double'
}

const DECIMAL_TYPES: Record<string, boolean> = {
  decimal: true,
  numeric: true,
  money: true,
  smallmoney: true,
  number: true
}

const DATE_TYPES: Record<string, boolean> = {
  date: true,
  datetime: true,
  timestamp: true,
  timestamptz: true,
  timestampz: true,
  'timestamp with time zone': true,
  'timestamp without time zone': true,
  datetime2: true,
  datetimeoffset: true,
  smalldatetime: true
}

const BOOL_TYPES: Record<string, boolean> = {
  boolean: true,
  bool: true,
  bit: true,
  tinyint1: true
}

const BLOB_TYPES: Record<string, boolean> = {
  binary: true,
  varbinary: true,
  blob: true,
  tinyblob: true,
  mediumblob: true,
  longblob: true,
  image: true,
  bytea: true,
  geometry: true,
  geography: true,
  point: true,
  linestring: true,
  polygon: true
}

const STANDARD_DATE_FORMAT =
  'yyyy-MM-dd HH:mm:ss||yyyy-MM-dd||epoch_millis||strict_date_optional_time'
const PURE_DATE_FORMAT = 'yyyy-MM-dd||epoch_millis'

export function ruleOptionsFromSettings(settings: Settings): MappingRuleOptions {
  return {
    keywordSubField: settings.autoKeywordSubField,
    ignoreAbove: settings.ignoreAbove,
    analyzer: settings.analyzer,
    analyzeAllStrings: settings.analyzeAllStrings,
    scaledFloatAsMoney: settings.scaledFloatAsMoney
  }
}

export function defaultRuleOptions(): MappingRuleOptions {
  return ruleOptionsFromSettings(DEFAULT_SETTINGS)
}

/** Convert a normalized DB data type into an ES mapped field descriptor. */
export function inferEsType(col: ColumnMeta, options: MappingRuleOptions): Partial<MappingField> {
  const t = col.dataType.toLowerCase()
  const isPk = col.primaryKey

  if (isPk) {
    return { esType: 'keyword', addKeyword: false, analyzed: false, indexable: true }
  }
  if (BOOL_TYPES[t] || (t === 'tinyint' && col.length === 1)) {
    return { esType: 'boolean', addKeyword: false, analyzed: false, indexable: true }
  }
  if (INTEGER_TYPES[t]) {
    return { esType: INTEGER_TYPES[t], addKeyword: false, analyzed: false, indexable: true }
  }
  if (FLOAT_TYPES[t]) {
    return { esType: FLOAT_TYPES[t], addKeyword: false, analyzed: false, indexable: true }
  }
  if (DECIMAL_TYPES[t]) {
    const cfg = options.scaledFloatAsMoney
      ? { esType: 'scaled_float', scalingFactor: 100 }
      : { esType: 'double' }
    return { ...cfg, addKeyword: false, analyzed: false, indexable: true }
  }
  if (DATE_TYPES[t]) {
    return {
      esType: 'date',
      addKeyword: false,
      analyzed: false,
      indexable: true,
      format: t === 'date' ? PURE_DATE_FORMAT : STANDARD_DATE_FORMAT
    }
  }
  if (TEXT_ONLY_TYPES[t]) {
    return {
      esType: 'text',
      addKeyword: options.keywordSubField && !options.analyzeAllStrings,
      analyzed: options.analyzeAllStrings,
      indexable: true,
      analyzer: options.analyzer
    }
  }
  if (STRING_TYPES[t]) {
    return {
      esType: 'text',
      addKeyword: options.keywordSubField,
      analyzed: options.analyzeAllStrings,
      indexable: true,
      analyzer: options.analyzer
    }
  }
  if (BLOB_TYPES[t]) {
    return {
      esType: 'keyword',
      addKeyword: false,
      analyzed: false,
      indexable: false,
      comment: 'binary/blob column, indexed as keyword'
    }
  }
  // fallback
  return { esType: 'keyword', addKeyword: false, analyzed: false, indexable: true }
}

/** Build the editing rows for the mapping editor. */
export function generateMappingFields(
  table: TableMeta,
  options: MappingRuleOptions
): MappingField[] {
  return table.columns.map((col) => {
    const inferred = inferEsType(col, options)
    return {
      column: col.name,
      field: col.name,
      esType: inferred.esType || 'keyword',
      addKeyword: inferred.addKeyword ?? false,
      indexable: inferred.indexable ?? true,
      analyzed: inferred.analyzed ?? false,
      analyzer: inferred.analyzer,
      ignoreAbove: options.ignoreAbove,
      scalingFactor: (inferred as { scalingFactor?: number }).scalingFactor,
      format: inferred.format,
      comment: col.comment || inferred.comment
    }
  })
}

/** Turn normalized fields into the ES mapping document sent to the cluster. */
export function buildMappingDocument(
  fields: MappingField[],
  settings?: Partial<Pick<Settings, 'defaultShards' | 'defaultReplicas'>>
): MappingDocument {
  const properties: Record<string, unknown> = {}
  for (const f of fields) {
    if (!f.field) continue
    const prop: Record<string, unknown> = { type: f.esType }
    if (f.esType === 'text') {
      if (f.addKeyword) {
        prop['fields'] = { keyword: { type: 'keyword', ignore_above: f.ignoreAbove ?? 256 } }
      }
      if (f.analyzed && f.analyzer && f.analyzer !== 'standard') {
        prop['analyzer'] = f.analyzer
      } else if (!f.analyzed && f.esType === 'text' && f.addKeyword) {
        // text with keyword sub-field: only the sub field is aggregatable
      }
    } else if (f.esType === 'scaled_float') {
      prop['scaling_factor'] = f.scalingFactor ?? 100
    } else if (f.esType === 'date' && f.format) {
      prop['format'] = f.format
    }
    if (f.indexable === false) {
      prop['index'] = false
    }
    if (f.comment) {
      prop['meta'] = { comment: f.comment }
    }
    properties[f.field] = prop
  }
  return {
    settings: {
      number_of_shards: settings?.defaultShards ?? 1,
      number_of_replicas: settings?.defaultReplicas ?? 0
    },
    mappings: { properties }
  }
}

export interface MappingIssue {
  field: string
  level: 'error' | 'warning'
  message: string
}

const VALID_ES_TYPES = [
  'text',
  'keyword',
  'long',
  'integer',
  'float',
  'double',
  'scaled_float',
  'boolean',
  'date',
  'geo_point',
  'object',
  'nested',
  'binary'
]

/** Validate the editing rows against ES mapping best practices. */
export function validateMapping(fields: MappingField[]): MappingIssue[] {
  const issues: MappingIssue[] = []
  const seen = new Map<string, string>()
  for (const f of fields) {
    if (!f.field) {
      issues.push({ field: f.column, level: 'error', message: 'ES 字段名为空' })
      continue
    }
    const prior = seen.get(f.field)
    if (prior) {
      issues.push({
        field: f.field,
        level: 'error',
        message: `ES 字段名重复（原字段 ${prior} 与 ${f.column}）`
      })
    } else {
      seen.set(f.field, f.column)
    }
    if (!VALID_ES_TYPES.includes(f.esType)) {
      issues.push({ field: f.field, level: 'error', message: `非法 ES 类型：${f.esType}` })
    }
    if (f.esType === 'date' && !f.format) {
      issues.push({ field: f.field, level: 'warning', message: 'date 字段缺少时间格式配置' })
    }
    if (f.esType === 'scaled_float' && !f.scalingFactor) {
      issues.push({ field: f.field, level: 'warning', message: 'scaled_float 缺少 scaling_factor' })
    }
    if (f.esType === 'text' && !f.indexable && !f.addKeyword) {
      issues.push({
        field: f.field,
        level: 'warning',
        message: 'text 字段既未索引也未加 keyword 子字段，不可检索'
      })
    }
  }
  return issues
}

/** Parse a pasted CREATE TABLE statement into a pseudo TableMeta for offline mapping. */
export function parseDDL(ddl: string): TableMeta | null {
  const d = ddl.replace(/\r/g, '')
  const tableMatch = d.match(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?([A-Za-z0-9_.]+)[`"]?\s*\(/i
  )
  if (!tableMatch) return null
  const tableName = tableMatch[1].split('.').pop() || tableMatch[1]
  const inner = d.slice(tableMatch.index! + tableMatch[0].length)
  const endIdx = inner.lastIndexOf(')')
  if (endIdx < 0) return null
  const body = inner.slice(0, endIdx)
  const lines = splitTopLevel(body)

  const columns: ColumnMeta[] = []
  const pkCols: string[] = []
  let tableComment: string | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    if (/^PRIMARY\s+KEY/i.test(line)) {
      const names = line.match(/\(([^)]*)\)/)?.[1] || ''
      for (const n of names.split(',')) {
        pkCols.push(n.trim().replace(/[`"]/g, ''))
      }
      continue
    }
    if (/^UNIQUE|^KEY|^INDEX|^CONSTRAINT|^FOREIGN/i.test(line)) continue
    if (/^\)\s*ENGINE|^ENGINE/i.test(line)) continue
    const colMatch = line.match(
      /^[`"]?([A-Za-z0-9_]+)[`"]?\s+([A-Za-z0-9_ ]+?)\s*(\([^)]*\))?((?:\s+UNSIGNED|\s+ZEROFILL)*)((?:\s+NULL|\s+NOT\s+NULL)*)((?:\s+DEFAULT[^,]*)?)((?:\s+AUTO_INCREMENT|\s+IDENTITY(?:\s*\(\d+,\d+\))?|\s+GENERATED[^,]*)?)((?:\s+COMMENT\s+['"][^'"]*['"])?)\s*$/i
    )
    if (!colMatch) continue
    const name = colMatch[1]
    const type = colMatch[2].trim().replace(/\s+/g, ' ').toLowerCase()
    const args = colMatch[3]
    const nullPart = colMatch[5] || ''
    const defaultPart = colMatch[6] || ''
    const autoPart = colMatch[7] || ''
    const commentPart = colMatch[8] || ''

    let length: number | null = null
    let precision: number | null = null
    let scale: number | null = null
    if (args) {
      const nums = args
        .replace(/[()]/g, '')
        .split(',')
        .map((s) => s.trim())
      if (nums.length === 1 && nums[0]) {
        const n = Number(nums[0])
        if (!isNaN(n) && isFinite(n)) {
          if (/decimal|numeric|number/i.test(type)) precision = n
          else length = n
        }
      } else if (nums.length >= 2) {
        precision = Number(nums[0]) || null
        scale = Number(nums[1]) || null
      }
    }
    const isPk = pkCols.includes(name)
    columns.push({
      name,
      rawType: (type + (args ? args.replace(/,/g, ',') : '')) as string,
      dataType: type,
      length,
      precision,
      scale,
      nullable: !/NOT\s+NULL/i.test(nullPart),
      primaryKey: isPk,
      autoIncrement: /AUTO_INCREMENT|IDENTITY|GENERATED/i.test(autoPart),
      default: defaultPart.match(/DEFAULT\s+(['"]?)(.*?)\1\s*$/i)?.[2] || null,
      comment: commentPart.replace(/COMMENT\s+['"]/i, '').replace(/['"]$/, '') || null
    })
  }

  // PRIMARY KEY may be declared after the column list, so apply it in a second pass
  for (const c of columns) {
    if (pkCols.includes(c.name)) {
      c.primaryKey = true
      c.nullable = false
    }
  }

  const commentMatch = d.match(/\)\s*ENGINE[^)]*COMMENT\s*=\s*['"]([^'"]*)['"]/is)
  if (commentMatch) tableComment = commentMatch[1]

  return {
    database: '',
    table: tableName,
    comment: tableComment,
    engine: null,
    columns,
    primaryKey: pkCols.length === 1 ? pkCols[0] : pkCols.length > 0 ? pkCols[0] : null,
    rowCount: 0
  }
}

/** Reverse an ES mapping document back into editable MappingField rows. */
export function parseMappingDocument(doc: MappingDocument): MappingField[] {
  const props = doc?.mappings?.properties as Record<string, unknown> | undefined
  if (!props || typeof props !== 'object') return []
  const fields: MappingField[] = []
  const prefix = 'imported_'
  for (const [fieldName, raw] of Object.entries(props)) {
    const p = (raw ?? {}) as Record<string, unknown>
    const esType = String(p.type ?? 'keyword')
    let addKeyword = false
    let ignoreAbove: number | undefined
    const keywordFields = (p.fields as Record<string, unknown> | undefined)?.keyword as
      | Record<string, unknown>
      | undefined
    if (keywordFields && String(keywordFields.type ?? '') === 'keyword') {
      addKeyword = true
      if (typeof keywordFields.ignore_above === 'number') {
        ignoreAbove = keywordFields.ignore_above as number
      } else if (typeof keywordFields.ignoreAbove === 'number') {
        ignoreAbove = keywordFields.ignoreAbove as number
      }
    }
    const analyzerProp = p.analyzer
    const analyzer = typeof analyzerProp === 'string' ? analyzerProp : undefined
    const analyzed = !!analyzer && analyzer !== 'standard'
    const indexable = p.index !== false
    let scalingFactor: number | undefined
    if (esType === 'scaled_float') {
      const sf = p.scaling_factor ?? p.scalingFactor
      if (typeof sf === 'number') scalingFactor = sf
    }
    let format: string | undefined
    if (esType === 'date' && typeof p.format === 'string') format = p.format
    const meta = p.meta as Record<string, unknown> | undefined
    const comment = typeof meta?.comment === 'string' ? meta.comment : undefined
    fields.push({
      column: prefix + fieldName + '_' + Math.random().toString(36).slice(2, 8),
      field: fieldName,
      esType,
      addKeyword,
      indexable,
      analyzed,
      analyzer: analyzer ?? 'standard',
      ignoreAbove,
      scalingFactor,
      format,
      comment
    })
  }
  return fields
}

function splitTopLevel(body: string): string[] {
  const lines: string[] = []
  let depth = 0
  let current = ''
  let inQuote: string | null = null
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (inQuote) {
      current += ch
      if (ch === inQuote) {
        if (body[i - 1] === '\\') continue
        inQuote = null
      }
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inQuote = ch
      current += ch
      continue
    }
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      lines.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) lines.push(current)
  return lines
}
