import { createDriver } from './metadata'
import { buildClient, esCount, esMget } from './es'
import { CompareRequest, CompareResult } from './types'

const BATCH = 1000

function normalizeValue(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString()
  if (Buffer.isBuffer(v)) return v.toString('base64')
  if (typeof v === 'bigint') return Number(v)
  if (Array.isArray(v)) return v.map(normalizeValue)
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {}
    const src = v as Record<string, unknown>
    for (const k of Object.keys(src).sort()) {
      out[k] = normalizeValue(src[k])
    }
    return out
  }
  return v
}

/** Loose equality: trims/coerces numeric strings and string numbers. */
function valuesRelaxedEqual(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined) a = null
  if (b === null || b === undefined) b = null
  if (a === b) return true
  if (typeof a === 'number' && typeof b === 'number') return a === b
  const an = Number(a)
  const bn = Number(b)
  if (!Number.isNaN(an) && !Number.isNaN(bn)) {
    if (typeof a === 'string' && typeof b === 'string') {
      if (a.trim() === '' || b.trim() === '') return a === b
    }
    return an === bn
  }
  return a === b
}

/** Returns diff paths (strict differences). Empty means values match. */
function collectDiffs(a: unknown, b: unknown, path: string, out: string[]): void {
  if (a === null || a === undefined) a = null
  if (b === null || b === undefined) b = null
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    if (Array.isArray(a) && Array.isArray(b)) {
      const len = Math.max(a.length, b.length)
      for (let i = 0; i < len; i++) {
        collectDiffs(a[i], b[i], `${path}[${i}]`, out)
      }
      return
    }
    const ka = Object.keys(a as object).sort()
    const kb = Object.keys(b as object).sort()
    const keys = Array.from(new Set([...ka, ...kb]))
    for (const k of keys) {
      collectDiffs(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        path ? `${path}.${k}` : k,
        out
      )
    }
    return
  }
  if (!valuesRelaxedEqual(a, b)) {
    out.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`)
  }
}

function rowHash(row: Record<string, unknown>): string {
  return JSON.stringify(normalizeValue(row))
}

/**
 * 数据对比校验：逐主键比对数据库表与 ES 索引文档的一致性。
 * 以主键值作为 ES `_id`（与同步任务写入方式一致）。
 */
export async function runCompare(req: CompareRequest): Promise<CompareResult> {
  const started = Date.now()
  const result: CompareResult = {
    dbCount: 0,
    esCount: 0,
    scanned: 0,
    matched: 0,
    mismatch: 0,
    missingInEs: 0,
    missingInEsSample: [],
    extraInEs: 0,
    mismatchSample: [],
    errors: [],
    elapsedMs: 0,
    limitReached: false
  }

  const driver = createDriver(req.db)
  const client = buildClient(req.es)
  const pk = req.primaryKey
  const limit = Math.max(1, Math.min(req.rowLimit || 50000, 500000))

  try {
    result.dbCount = await driver.countRows(req.database, req.table)
    result.esCount = await esCount(req.es, req.esIndex)

    let lastId: string | number | null = null
    let scanned = 0

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const rows = await driver.queryPage(req.database, req.table, pk, lastId, BATCH)
      if (rows.length === 0) break

      const ids: string[] = []
      const docs: Array<Record<string, unknown>> = []
      const idToRow = new Map<string, Record<string, unknown>>()
      for (const row of rows) {
        const id = String((row as Record<string, unknown>)[pk] ?? '')
        if (!id) continue
        ids.push(id)
        idToRow.set(id, row)
        docs.push(row)
      }

      const esDocs = await esMget(req.es, req.esIndex, ids)
      const esById = new Map<string, { found: boolean; source: Record<string, unknown> | null }>()
      for (const d of esDocs) esById.set(d._id, d)

      for (const row of docs) {
        const id = String((row as Record<string, unknown>)[pk] ?? '')
        const es = esById.get(id)
        if (!es || !es.found) {
          result.missingInEs++
          if (result.missingInEsSample.length < 20) result.missingInEsSample.push(id)
          continue
        }
        const dbHash = rowHash(row as Record<string, unknown>)
        const esHash = rowHash(es.source || {})
        if (dbHash === esHash) {
          result.matched++
        } else {
          const diffs: string[] = []
          collectDiffs(row, es.source || {}, '', diffs)
          result.mismatch++
          if (result.mismatchSample.length < 50) {
            result.mismatchSample.push({
              id,
              reason: diffs.length > 0 ? diffs.slice(0, 3).join('; ') : '数据内容不一致',
              db: JSON.stringify(normalizeValue(row)),
              es: JSON.stringify(normalizeValue(es.source || {}))
            })
          }
        }
      }

      scanned += rows.length
      const lastRow = rows[rows.length - 1]
      lastId = (lastRow as Record<string, unknown>)[pk] as string | number
      if (scanned >= limit) {
        result.limitReached = true
        break
      }
      if (rows.length < BATCH) break
    }

    result.scanned = scanned
    // ES 中在本轮已对比主键之外多余的文档数量（近似，仅当未截断时精确）
    if (!result.limitReached) {
      result.extraInEs = Math.max(
        0,
        result.esCount - (result.matched + result.mismatch + result.missingInEs)
      )
    }
  } catch (e) {
    result.errors.push(String((e as Error).message))
  } finally {
    await driver.close()
    client.close()
  }

  result.elapsedMs = Date.now() - started
  return result
}
