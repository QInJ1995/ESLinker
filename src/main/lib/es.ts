import { Client } from '@elastic/elasticsearch'
import { EsConfig, MappingDocument } from './types'
import { dialog, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'fs'

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
    requestTimeout: 30000
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
    mappings: doc.mappings as never
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
    mappings: doc.mappings as never
  })
  return true
}

export async function esUpdateMapping(
  cfg: EsConfig,
  index: string,
  properties: Record<string, unknown>
): Promise<void> {
  const client = buildClient(cfg)
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
  for (const doc of docs) {
    const id = doc[primaryKey]
    if (options.action === 'delete') {
      operations.push({ delete: { _index: index, _id: String(id) } })
    } else {
      operations.push({ index: { _index: index, _id: String(id) } })
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
  return res as unknown as Record<string, unknown>
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
