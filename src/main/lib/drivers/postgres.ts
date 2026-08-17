import { Client } from 'pg'
import { DBDriver, normType } from './driver'
import { ColumnMeta, DbConfig, TableMeta } from '../types'

export class PostgresDriver implements DBDriver {
  readonly type = 'postgres'
  private cfg: DbConfig

  constructor(cfg: DbConfig) {
    this.cfg = cfg
  }

  private client(database?: string): Client {
    return new Client({
      host: this.cfg.host,
      port: this.cfg.port || 5432,
      user: this.cfg.username,
      password: this.cfg.password,
      database: database || this.cfg.database || 'postgres',
      connectionTimeoutMillis: 5000,
      ssl: this.cfg.useSsl ? { rejectUnauthorized: false } : undefined
    })
  }

  async testConnection(): Promise<void> {
    const c = this.client()
    try {
      await c.connect()
      await c.query('SELECT 1')
    } finally {
      await c.end()
    }
  }

  async listDatabases(): Promise<string[]> {
    const c = this.client()
    try {
      await c.connect()
      const res = await c.query(
        "SELECT datname FROM pg_database WHERE datistemplate = false AND datname <> 'postgres' ORDER BY datname"
      )
      return res.rows.map((r) => r['datname'] as string)
    } finally {
      await c.end()
    }
  }

  async listTables(database: string): Promise<Array<{ name: string; comment?: string | null }>> {
    const c = this.client(database)
    try {
      await c.connect()
      const res = await c.query(
        `SELECT c.relname AS name, COALESCE(obj_description(c.oid), '') AS comment
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind IN ('r','p') AND n.nspname = 'public'
         ORDER BY c.relname`
      )
      return res.rows.map((r) => ({ name: r['name'], comment: r['comment'] || null }))
    } finally {
      await c.end()
    }
  }

  async getTableMeta(database: string, table: string): Promise<TableMeta> {
    const c = this.client(database)
    try {
      await c.connect()
      const colsRes = await c.query(
        `SELECT column_name, udt_name, data_type, character_maximum_length,
                numeric_precision, numeric_scale, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position`,
        [table]
      )
      const pkRes = await c.query(
        `SELECT a.attname AS name
         FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
         WHERE i.indrelid = $1::regclass AND i.indisprimary`,
        [table]
      )
      const tabRes = await c.query(`SELECT obj_description($1::regclass) AS comment`, [table])
      const cntRes = await c.query(`SELECT COUNT(*)::int AS n FROM "${table}"`)
      const pkCols = new Set(pkRes.rows.map((r) => r['name'] as string))
      const columns: ColumnMeta[] = colsRes.rows.map((r) => ({
        name: r['column_name'],
        rawType: r['udt_name'] as string,
        dataType: normType(r['data_type'] as string),
        length:
          r['character_maximum_length'] != null ? Number(r['character_maximum_length']) : null,
        precision: r['numeric_precision'] != null ? Number(r['numeric_precision']) : null,
        scale: r['numeric_scale'] != null ? Number(r['numeric_scale']) : null,
        nullable: r['is_nullable'] === 'YES',
        primaryKey: pkCols.has(r['column_name']),
        autoIncrement: String(r['column_default'] || '').includes('nextval'),
        default: r['column_default'] != null ? String(r['column_default']) : null,
        comment: null
      }))
      const pk: string | null = columns.find((x) => x.primaryKey)?.name || null
      return {
        database,
        table,
        comment: tabRes.rows[0]?.comment || null,
        engine: null,
        columns,
        primaryKey: pk,
        rowCount: Number(cntRes.rows[0]?.['n'] ?? 0)
      }
    } finally {
      await c.end()
    }
  }

  async countRows(database: string, table: string): Promise<number> {
    const c = this.client(database)
    try {
      await c.connect()
      const res = await c.query(`SELECT COUNT(*)::int AS n FROM "${table}"`)
      return Number(res.rows[0]?.['n'] ?? 0)
    } finally {
      await c.end()
    }
  }

  async queryPage(
    database: string,
    table: string,
    primaryKey: string,
    lastId: string | number | null,
    pageSize: number
  ): Promise<Array<Record<string, unknown>>> {
    const c = this.client(database)
    try {
      await c.connect()
      const res =
        lastId !== null && lastId !== undefined
          ? await c.query(
              `SELECT * FROM "${table}" WHERE "${primaryKey}" > $1 ORDER BY "${primaryKey}" ASC LIMIT $2`,
              [lastId, pageSize]
            )
          : await c.query(`SELECT * FROM "${table}" ORDER BY "${primaryKey}" ASC LIMIT $1`, [
              pageSize
            ])
      return res.rows
    } finally {
      await c.end()
    }
  }

  async close(): Promise<void> {
    // connections are created per-call for a lean desktop tool
  }
}
