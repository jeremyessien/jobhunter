import type { Client } from '@libsql/client'
import type { Config } from '@jobhunter/core'
import type { RawJob } from '../types'

export type AdapterCtx = {
  db: Client
  config: Config
  fetchJson(url: string): Promise<unknown>
}

export type SourceAdapter = {
  name: string
  fetchJobs(ctx: AdapterCtx): Promise<RawJob[]>
}
