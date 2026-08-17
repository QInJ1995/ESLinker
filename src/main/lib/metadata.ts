import { DBDriver } from './drivers/driver'
import { MysqlDriver } from './drivers/mysql'
import { PostgresDriver } from './drivers/postgres'
import { MssqlDriver } from './drivers/mssql'
import { DbConfig, TableMeta } from './types'

export function createDriver(cfg: DbConfig): DBDriver {
  switch (cfg.type) {
    case 'mysql':
      return new MysqlDriver(cfg)
    case 'postgres':
      return new PostgresDriver(cfg)
    case 'mssql':
      return new MssqlDriver(cfg)
    default:
      throw new Error(`Unsupported database type: ${cfg.type}`)
  }
}

export async function testDbConnection(cfg: DbConfig): Promise<void> {
  const driver = createDriver(cfg)
  try {
    await driver.testConnection()
  } finally {
    await driver.close()
  }
}

export interface TreeResult {
  databases: string[]
  trees: Array<{ database: string; tables: Array<{ name: string; comment?: string | null }> }>
}

export async function readTree(cfg: DbConfig): Promise<TreeResult> {
  const driver = createDriver(cfg)
  try {
    const databases = await driver.listDatabases()
    const trees: TreeResult['trees'] = []
    for (const db of databases.slice(0, 200)) {
      const tables = await driver.listTables(db)
      trees.push({ database: db, tables })
    }
    return { databases, trees }
  } finally {
    await driver.close()
  }
}

export async function readTableMeta(
  cfg: DbConfig,
  database: string,
  table: string
): Promise<TableMeta> {
  const driver = createDriver(cfg)
  try {
    return await driver.getTableMeta(database, table)
  } finally {
    await driver.close()
  }
}
