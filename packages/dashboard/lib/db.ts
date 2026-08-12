import { join, resolve } from 'node:path'
import type { Client } from '@libsql/client'
import { loadConfig, openDb, type Config } from '@jobhunter/core'

export const repoRoot = process.env.JOBHUNTER_ROOT ?? resolve(process.cwd(), '..', '..')
export const configPath = join(repoRoot, 'jobhunter.config.json')

export function getConfig(): Config {
  return loadConfig(configPath)
}

let client: Promise<Client> | null = null

export function getDb(): Promise<Client> {
  if (!client) {
    const config = getConfig()
    const url = config.dbUrl.startsWith('file:')
      ? 'file:' + resolve(repoRoot, config.dbUrl.slice(5))
      : config.dbUrl
    client = openDb(url, config.dbAuthToken)
  }
  return client
}
