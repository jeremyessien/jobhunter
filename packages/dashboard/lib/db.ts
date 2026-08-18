import { join, resolve } from 'node:path'
import type { Client } from '@libsql/client'
import { openDb, loadConfigFromDb, type Config } from '@jobhunter/core'

// hosted deployments set JOBHUNTER_DB_URL; local runs fall back to the repo database
const defaultDbUrl = () =>
  'file:' + join(process.env.JOBHUNTER_ROOT ?? resolve(process.cwd(), '..', '..'), 'jobhunter.db')

let client: Promise<Client> | null = null

export function getDb(): Promise<Client> {
  if (!client) {
    client = openDb(process.env.JOBHUNTER_DB_URL ?? defaultDbUrl(), process.env.JOBHUNTER_DB_AUTH_TOKEN).catch(
      (e) => {
        client = null
        throw e
      },
    )
  }
  return client
}

export async function getConfig(): Promise<Config> {
  return loadConfigFromDb(await getDb())
}
