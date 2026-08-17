import sql from 'mssql'
import { DBDriver, normType } from './driver'
import { ColumnMeta, DbConfig, TableMeta } from '../types'

export class MssqlDriver implements DBDriver {
  readonly type = 'mssql'
  private cfg: DbConfig

  constructor(cfg: DbConfig) {
    this.cfg = cfg
  }

  private pool(): sql.ConnectionPool {
    return new sql.ConnectionPool({
      server: this.cfg.host,
      port: this.cfg.port || 1433,
      user: this.cfg.username,
      password: this.cfg.password,
      database: this.cfg.database,
      pool: { max: 1, min: 0, idleTimeoutMillis: 10000 },
      options: {
        encrypt: Boolean(this.cfg.useSsl),
        trustServerCertificate: Boolean(this.cfg.useSsl)
      },
      connectionTimeout: 10000
    })
  }

  async testConnection(): Promise<void> {
    const p = this.pool()
    try {
      await p.connect()
      await p.request().query('SELECT 1')
    } finally {
      await p.close()
    }
  }

  async listDatabases(): Promise<string[]> {
    const p = this.pool()
    try {
      await p.connect()
      const res = await p
        .request()
        .query('SELECT name FROM sys.databases WHERE database_id > 4 ORDER BY name')
      return res.recordset.map((r) => r['name'] as string)
    } finally {
      await p.close()
    }
  }

  async listTables(database: string): Promise<Array<{ name: string; comment?: string | null }>> {
    const p = this.pool()
    try {
      await p.connect()
      const res = await p
        .request()
        .input('db', sql.NVarChar, database)
        .query(
          `SELECT t.name AS name,
                  CAST(COALESCE(ep.value, '') AS nvarchar(4000)) AS comment
           FROM ${bq(database)}.sys.tables t
           LEFT JOIN ${bq(database)}.sys.extended_properties ep
             ON ep.major_id = t.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
           ORDER BY t.name`
        )
      return res.recordset.map((r) => ({ name: r['name'], comment: r['comment'] || null }))
    } finally {
      await p.close()
    }
  }

  async getTableMeta(database: string, table: string): Promise<TableMeta> {
    const p = this.pool()
    try {
      await p.connect()
      const colsRes = await p
        .request()
        .input('table', sql.NVarChar, table)
        .input('db', sql.NVarChar, database)
        .query(
          `SELECT c.name AS name, t.name AS type, c.max_length, c.precision, c.scale,
                  c.is_nullable, c.is_identity, dc.definition AS [default],
                  CAST(ep.value AS nvarchar(4000)) AS comment
           FROM ${bq(database)}.sys.columns c
           JOIN ${bq(database)}.sys.types t ON c.user_type_id = t.user_type_id
           LEFT JOIN ${bq(database)}.sys.default_constraints dc ON dc.object_id = c.default_object_id
           LEFT JOIN ${bq(database)}.sys.extended_properties ep
             ON ep.major_id = c.object_id AND ep.minor_id = c.column_id AND ep.name = 'MS_Description'
           WHERE c.object_id = OBJECT_ID(@db + '.' + @table)
           ORDER BY c.column_id`
        )
      const pkRes = await p
        .request()
        .input('table', sql.NVarChar, table)
        .input('db', sql.NVarChar, database)
        .query(
          `SELECT col.name AS name
           FROM ${bq(database)}.sys.indexes i
           JOIN ${bq(database)}.sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
           JOIN ${bq(database)}.sys.columns col ON ic.object_id = col.object_id AND ic.column_id = col.column_id
           WHERE i.is_primary_key = 1 AND i.object_id = OBJECT_ID(@db + '.' + @table)`
        )
      const cntRes = await p
        .request()
        .input('table', sql.NVarChar, table)
        .query(
          `SELECT COUNT_BIG(*) AS n FROM ${bq(database)}.${bq(table.split('.')[0] || table)}.dbo.${bq(table)}`
        )
      const pkCols = new Set(pkRes.recordset.map((r) => r['name'] as string))
      const columns: ColumnMeta[] = colsRes.recordset.map((r) => ({
        name: r['name'],
        rawType: r['type'] as string,
        dataType: normType(r['type'] as string),
        length: r['max_length'] > 0 ? Number(r['max_length']) : null,
        precision: r['precision'] != null ? Number(r['precision']) : null,
        scale: r['scale'] != null ? Number(r['scale']) : null,
        nullable: r['is_nullable'] === true,
        primaryKey: pkCols.has(r['name']),
        autoIncrement: r['is_identity'] === true,
        default: r['default'] != null ? String(r['default']) : null,
        comment: r['comment'] ? String(r['comment']) : null
      }))
      const dbParts = database.split('.')
      const dbName = dbParts[0] || database
      const schema = dbParts[1] || 'dbo'
      const safeTable = table.split('.').pop() || table
      const cntRes2 = await p
        .request()
        .query(`SELECT COUNT_BIG(*) AS n FROM [${dbName}].${bq(schema)}.${bq(safeTable)}`)
      return {
        database,
        table,
        comment: null,
        engine: null,
        columns,
        primaryKey: pkCols.size === 1 ? columns.find((x) => x.primaryKey)?.name || null : null,
        rowCount: Number(cntRes2.recordset[0]?.['n'] ?? Number(cntRes.recordset[0]?.['n'] ?? 0))
      }
    } finally {
      await p.close()
    }
  }

  async countRows(database: string, table: string): Promise<number> {
    const parts = database.split('.')
    const db = parts[0] || database
    const schema = parts[1] || 'dbo'
    const t = table.split('.').pop() || table
    const p = this.pool()
    try {
      await p.connect()
      const res = await p
        .request()
        .query(`SELECT COUNT_BIG(*) AS n FROM [${db}].${bq(schema)}.${bq(t)}`)
      return Number(res.recordset[0]?.['n'] ?? 0)
    } finally {
      await p.close()
    }
  }

  async queryPage(
    database: string,
    table: string,
    primaryKey: string,
    lastId: string | number | null,
    pageSize: number
  ): Promise<Array<Record<string, unknown>>> {
    const parts = database.split('.')
    const db = parts[0] || database
    const schema = parts[1] || 'dbo'
    const t = table.split('.').pop() || table
    const fq = `[${db}].${bq(schema)}.${bq(t)}`
    const p = this.pool()
    try {
      await p.connect()
      const isNumeric =
        typeof lastId === 'number' || (typeof lastId === 'string' && /^\d+$/.test(lastId))
      if (lastId !== null && lastId !== undefined) {
        const req = p.request()
        if (isNumeric) req.input('last', sql.BigInt, lastId as string | number)
        else req.input('last', sql.NVarChar(4000), String(lastId))
        req.input('size', sql.Int, pageSize)
        const res = await req.query(
          `SELECT TOP (@size) * FROM ${fq} WHERE ${bq(primaryKey)} > @last ORDER BY ${bq(primaryKey)} ASC`
        )
        return res.recordset
      }
      const req = p.request()
      req.input('size', sql.Int, pageSize)
      const res = await req.query(`SELECT TOP (@size) * FROM ${fq} ORDER BY ${bq(primaryKey)} ASC`)
      return res.recordset
    } finally {
      await p.close()
    }
  }

  async close(): Promise<void> {
    // connections are created per-call for a lean desktop tool
  }
}

function bq(id: string): string {
  return `[${id.replace(/]/g, ']]')}]`
}
