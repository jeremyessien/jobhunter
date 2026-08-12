import type { Client } from '@libsql/client'
import type { Config, InvokeClaude } from '@jobhunter/core'
import type { SourceAdapter } from './sources/types'
import { ingestJobs } from './pipeline/ingest'
import { runFilter } from './pipeline/filter'
import { runJudge } from './pipeline/judge'
import { runDrafter } from './pipeline/drafter'
import { getProfile } from './profile'

export async function hunt(deps: {
  db: Client
  config: Config
  adapters: SourceAdapter[]
  invoke: InvokeClaude
  fetchJson: (url: string) => Promise<unknown>
  now: string
}) {
  const { db, config, adapters, invoke, fetchJson, now } = deps
  const runs: { source: string; ok: boolean; jobsFound: number }[] = []

  for (const adapter of adapters) {
    const ins = await db.execute({
      sql: 'INSERT INTO runs(started_at, source) VALUES (?, ?) RETURNING id',
      args: [now, adapter.name],
    })
    const runId = ins.rows[0].id
    try {
      const raws = await adapter.fetchJobs({ db, config, fetchJson })
      await ingestJobs(db, raws, now)
      await db.execute({
        sql: "UPDATE runs SET finished_at=datetime('now'), ok=1, jobs_found=? WHERE id=?",
        args: [raws.length, runId],
      })
      runs.push({ source: adapter.name, ok: true, jobsFound: raws.length })
    } catch (err) {
      await db.execute({
        sql: "UPDATE runs SET finished_at=datetime('now'), ok=0, error=?, jobs_found=0 WHERE id=?",
        args: [String(err), runId],
      })
      runs.push({ source: adapter.name, ok: false, jobsFound: 0 })
    }
  }

  const filter = await runFilter(db, config)
  const profile = await getProfile(db)
  const judge = profile ? await runJudge(db, config, profile, invoke, now) : null
  const draft = profile ? await runDrafter({ db, config, profile, invoke, fetchJson }) : null
  return { runs, filter, judge, draft }
}
