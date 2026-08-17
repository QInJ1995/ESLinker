import { Client } from '@elastic/elasticsearch'
import { Transport } from '@elastic/transport'
import { EsConfig, EsVersion, MappingDocument } from './types'
import { dialog, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'fs'

/**
 * Transport that skips the `x-elastic-product` guarantee check.
 * ES 6/7 do not send the header, so the default v8/9 client would reject them.
 * Dropping the check keeps the REST client usable across ES 6.8+ / 7.x / 8.x.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
class CompatibleTransport extends (Transport as any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(opts: any) {
    super({ ...opts, productCheck: null })
  }
}

export function buildClient(cfg: EsConfig): Client {
  const protocol = cfg.secure ? 'https' : 'http'
  const node = `${protocol}://${cfg.host}:${cfg.port}`
  const auth: Record<string, unknown> = {}
  if (cfg.apiKey) {
    auth['auth'] = { apiKey: cfg.apiKey }
  } else if (cfg.username) {
    auth['auth'] = { username: cfg.username, password: cfg.password }
  }
  return new Client({
    node,
    ...(auth as { auth: { username: string; password: string } | { apiKey: string } }),
    requestTimeout: 30000,
    Transport: CompatibleTransport as never
  })
}

export async function testEsConnection(
  cfg: EsConfig
): Promise<{ version: string; cluster: string }> {
  const client = buildClient(cfg)
  const info = await client.info()
  return {
    version: String(info.version?.number ?? ''),
    cluster: String(info.cluster_name ?? '')
  }
}

export async function esIndexExists(cfg: EsConfig, index: string): Promise<boolean> {
  const client = buildClient(cfg)
  return client.indices.exists({ index })
}

/** Wrap/unwrap mapping body for ES 6.x (single mapping type `_doc`). */
export function mappingBody(mappings: unknown, version: EsVersion): unknown {
  if (version === '6') return { _doc: mappings }
  return mappings
}

export async function esCreateIndex(
  cfg: EsConfig,
  index: string,
  doc: MappingDocument,
  options: { overwrite: boolean }
): Promise<{ created: boolean; existed: boolean }> {
  const client = buildClient(cfg)
  const exists = await esIndexExists(cfg, index)
  if (exists) {
    if (!options.overwrite) return { created: false, existed: true }
    await client.indices.delete({ index })
  }
  await client.indices.create({
    index,
    settings: doc.settings as never,
    mappings: mappingBody(doc.mappings as never, cfg.version) as never
  })
  return { created: true, existed: exists }
}

export async function esCreateIndexForce(
  cfg: EsConfig,
  index: string,
  doc: MappingDocument
): Promise<boolean> {
  const client = buildClient(cfg)
  await client.indices.create({
    index,
    settings: doc.settings as never,
    mappings: mappingBody(doc.mappings as never, cfg.version) as never
  })
  return true
}

export async function esUpdateMapping(
  cfg: EsConfig,
  index: string,
  properties: Record<string, unknown>
): Promise<void> {
  const client = buildClient(cfg)
  if (cfg.version === '6') {
    const path = `/${encodeURIComponent(index)}/_mapping/_doc`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client.transport as any).request({ method: 'PUT', path, body: { properties } })
    return
  }
  await client.indices.putMapping({ index, properties: properties as never })
}

export async function esDeleteIndex(cfg: EsConfig, index: string): Promise<void> {
  const client = buildClient(cfg)
  await client.indices.delete({ index })
}

export async function esBulkWrite(
  cfg: EsConfig,
  index: string,
  docs: Array<Record<string, unknown>>,
  primaryKey: string,
  options: { action: 'index' | 'upsert' | 'delete' }
): Promise<{ ok: number; failed: number; error?: string }> {
  const client = buildClient(cfg)
  const operations: unknown[] = []
  const metaType = cfg.version === '6' ? { _type: '_doc' } : {}
  for (const doc of docs) {
    const id = doc[primaryKey]
    if (options.action === 'delete') {
      operations.push({ delete: { _index: index, _id: String(id), ...metaType } })
    } else {
      operations.push({ index: { _index: index, _id: String(id), ...metaType } })
      operations.push(cleanDoc(doc))
    }
  }
  const retry = 3
  for (let attempt = 0; attempt <= retry; attempt++) {
    try {
      const res = await client.bulk({ operations: operations as never, refresh: false })
      if (res.errors) {
        const failed = (res.items || []).filter(
          (i) => i.index?.error || i.delete?.error || i.update?.error
        ).length
        const msg =
          failed > 0 ? (failed <= 3 ? JSON.stringify(failed[0]) : `${failed} items failed`) : ''
        return {
          ok: docs.length - failed,
          failed,
          error: typeof msg === 'string' ? msg : undefined
        }
      }
      return { ok: docs.length, failed: 0 }
    } catch (e) {
      if (attempt === retry) return { ok: 0, failed: docs.length, error: (e as Error).message }
    }
  }
  return { ok: 0, failed: docs.length, error: 'bulk write failed' }
}

function cleanDoc(doc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(doc)) {
    const v = doc[key]
    if (v instanceof Date) {
      out[key] = v.toISOString()
    } else if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Buffer)) {
      try {
        out[key] = JSON.parse(JSON.stringify(v))
      } catch {
        out[key] = String(v)
      }
    } else if (v instanceof Buffer) {
      out[key] = v.toString('base64')
    } else if (v === undefined) {
      out[key] = null
    } else {
      out[key] = v
    }
  }
  return out
}

export async function esIndexMapping(
  cfg: EsConfig,
  index: string
): Promise<Record<string, unknown>> {
  const client = buildClient(cfg)
  const res = await client.indices.getMapping({ index })
  const body = res as unknown as Record<string, unknown>
  // unwrap ES6 `_doc` type
  const indexBody = body[index] as Record<string, unknown> | undefined
  const mappings = indexBody?.mappings as Record<string, unknown> | undefined
  if (mappings && typeof mappings === 'object' && !('properties' in mappings)) {
    const inner = (mappings._doc ?? mappings.doc) as Record<string, unknown> | undefined
    if (inner) {
      body[index] = { ...(indexBody as object), mappings: inner } as Record<string, unknown>
    }
  }
  return body
}

export async function esCount(cfg: EsConfig, index: string): Promise<number> {
  const client = buildClient(cfg)
  const res = await client.count({ index })
  return res.count ?? 0
}

/**
 * Fetch documents by `_id`. Uses `_mget` which works without a mapping type on
 * ES 6.8+ (type is optional at the `/_mget` endpoint) as well as 7.x/8.x.
 */
export async function esMget(
  cfg: EsConfig,
  index: string,
  ids: string[]
): Promise<Array<{ _id: string; found: boolean; source: Record<string, unknown> | null }>> {
  const client = buildClient(cfg)
  const res = await client.mget({ index, ids })
  const docs = res.docs || []
  return docs.map((d) => {
    const hit = d as {
      _id?: string
      found?: boolean
      _source?: Record<string, unknown>
      error?: unknown
    }
    return {
      _id: String(hit._id ?? ''),
      found: Boolean(hit.found) && !hit.error,
      source: hit._source ?? null
    }
  })
}

export async function exportMappingJson(
  doc: MappingDocument,
  fileName: string
): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  const result = await dialog.showSaveDialog(win, { defaultPath: fileName })
  if (result.canceled || !result.filePath) return null
  writeFileSync(result.filePath, JSON.stringify(doc, null, 2), 'utf8')
  return result.filePath
}

export async function importMappingJson(): Promise<{ doc: MappingDocument; path: string } | null> {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  const result = await dialog.showOpenDialog(win, {
    title: '导入 Mapping JSON',
    filters: [{ name: 'JSON', extensions: ['json', 'mapping.json'] }],
    properties: ['openFile']
  })
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) return null
  const filePath = result.filePaths[0]
  const raw = readFileSync(filePath, 'utf8')
  const doc = JSON.parse(raw) as MappingDocument
  return { doc, path: filePath }
}
