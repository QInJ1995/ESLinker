import mysql from 'mysql2/promise'
import { DBDriver, normType } from './driver'
import { ColumnMeta, DbConfig, TableMeta } from '../types'

export class MysqlDriver implements DBDriver {
  readonly type = 'mysql'
  private cfg: DbConfig

  constructor(cfg: DbConfig) {
    this.cfg = cfg
  }

  private async conn(): Promise<mysql.Connection> {
    return mysql.createConnection({
      host: this.cfg.host,
      port: this.cfg.port || 3306,
      user: this.cfg.username,
      password: this.cfg.password,
      database: this.cfg.database,
      connectTimeout: 10000
    })
  }

  async testConnection(): Promise<void> {
    const c = await this.conn()
    try {
      await c.query('SELECT 1')
    } finally {
      await c.end()
    }
  }

  async listDatabases(): Promise<string[]> {
    const c = await this.conn()
    try {
      const [rows] = await c.query<mysql.RowDataPacket[]>(
        "SHOW DATABASES WHERE `Database` NOT IN ('information_schema','performance_schema','mysql','sys')"
      )
      return rows.map((r) => Object.values(r)[0] as string)
    } finally {
      await c.end()
    }
  }

  async listTables(database: string): Promise<Array<{ name: string; comment?: string | null }>> {
    const c = await this.conn()
    try {
      const [rows] = await c.query<mysql.RowDataPacket[]>(
        `SELECT TABLE_NAME AS name, TABLE_COMMENT AS comment
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
         ORDER BY TABLE_NAME`,
        [database]
      )
      return rows.map((r) => ({ name: r['name'], comment: r['comment'] }))
    } finally {
      await c.end()
    }
  }

  async getTableMeta(database: string, table: string): Promise<TableMeta> {
    const c = await this.conn()
    try {
      await c.query('USE `' + database.replace(/`/g, '') + '`')
      const [cols] = await c.query<mysql.RowDataPacket[]>(
        `SELECT COLUMN_NAME, COLUMN_TYPE, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH,
                NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE, COLUMN_KEY,
                EXTRA, COLUMN_DEFAULT, COLUMN_COMMENT
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [database, table]
      )
      const [tabs] = await c.query<mysql.RowDataPacket[]>(
        `SELECT TABLE_COMMENT, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`,
        [database, table]
      )
      const [cnt] = await c.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM \`${table.replace(/`/g, '``')}\``
      )
      const columns: ColumnMeta[] = cols.map((r) => ({
        name: r['COLUMN_NAME'],
        rawType: r['COLUMN_TYPE'] as string,
        dataType: normType(r['DATA_TYPE'] as string),
        length:
          r['CHARACTER_MAXIMUM_LENGTH'] != null ? Number(r['CHARACTER_MAXIMUM_LENGTH']) : null,
        precision: r['NUMERIC_PRECISION'] != null ? Number(r['NUMERIC_PRECISION']) : null,
        scale: r['NUMERIC_SCALE'] != null ? Number(r['NUMERIC_SCALE']) : null,
        nullable: r['IS_NULLABLE'] === 'YES',
        primaryKey: r['COLUMN_KEY'] === 'PRI',
        autoIncrement: String(r['EXTRA']).includes('auto_increment'),
        default: r['COLUMN_DEFAULT'] != null ? String(r['COLUMN_DEFAULT']) : null,
        comment: r['COLUMN_COMMENT'] ? String(r['COLUMN_COMMENT']) : null
      }))
      const pkCol = columns.find((x) => x.primaryKey)
      const tRow = tabs[0]
      return {
        database,
        table,
        comment: tRow ? String(tRow['TABLE_COMMENT']) : null,
        engine: tRow ? String(tRow['ENGINE']) : null,
        columns,
        primaryKey: pkCol ? pkCol.name : null,
        rowCount: Number(cnt[0]?.['n'] ?? 0)
      }
    } finally {
      await c.end()
    }
  }

  async countRows(database: string, table: string): Promise<number> {
    const c = await this.conn()
    try {
      await c.query('USE `' + database.replace(/`/g, '') + '`')
      const [cnt] = await c.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM ${qtSafe(table)}`
      )
      return Number(cnt[0]?.['n'] ?? 0)
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
    const c = await this.conn()
    try {
      await c.query('USE `' + database.replace(/`/g, '') + '`')
      const t = qtSafe(table)
      const pk = qtSafe(primaryKey)
      let sql: string
      const params: Array<string | number> = []
      if (lastId !== null && lastId !== undefined) {
        sql = `SELECT * FROM ${t} WHERE ${pk} > ? ORDER BY ${pk} ASC LIMIT ?`
        params.push(lastId, pageSize)
      } else {
        sql = `SELECT * FROM ${t} ORDER BY ${pk} ASC LIMIT ?`
        params.push(pageSize)
      }
      const [rows] = await c.query<mysql.RowDataPacket[]>(sql, params)
      return rows.map((r) => ({ ...r }))
    } finally {
      await c.end()
    }
  }

  async close(): Promise<void> {
    // connections are created per-call for a lean desktop tool
  }
}

function qtSafe(id: string): string {
  return `\`${id.replace(/`/g, '``')}\``
}
