import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, configSchema, type InvokeClaude } from '@jobhunter/core'
import { runJudge, scoreSchema } from '../src/pipeline/judge.js'
import type { Profile } from '../src/profile.js'

const NOW = '2026-08-11T09:00:00Z'
const config = configSchema.parse({
  scoreCapPerHunt: 2,
  lanes: [{ id: 'x', titlePatterns: ['a'], rule: 'any' }],
})
const profile: Profile = {
  name: 'J', email: 'j@x.com', location: 'Lagos', links: [], skills: ['Flutter'],
  experience: [], education: [], screening: {},
}

async function seedJob(db: Awaited<ReturnType<typeof openDb>>, key: string, company: string, postedAt: string, status = 'matched', submittedAt?: string) {
  await db.execute({
    sql: `INSERT INTO jobs(external_key, title, company, description, apply_url, source, first_seen, posted_at, status, lane, submitted_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    args: [key, 'Senior Flutter Engineer', company, 'desc', 'url', 's', NOW, postedAt, status, 'x', submittedAt ?? null],
  })
}

const invokeWith = (score: number | Error): InvokeClaude =>
  (async () => {
    if (score instanceof Error) throw score
    return { score, matched_strengths: [{ claim: 'Flutter', evidence: 'skills' }], gaps: [], verdict: 'good fit' }
  }) as InvokeClaude

const tmpDb = () => openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))

describe('runJudge', () => {
  it('scores matched jobs and queues those at or above threshold', async () => {
    const db = await tmpDb()
    await seedJob(db, 'a:1', 'A', '2026-08-10')
    const res = await runJudge(db, config, profile, invokeWith(8), NOW)
    expect(res).toEqual({ scored: 1, queued: 1, failed: 0 })
    const rs = await db.execute("SELECT status, score, score_json FROM jobs WHERE external_key='a:1'")
    expect(rs.rows[0].status).toBe('queued')
    expect(rs.rows[0].score).toBe(8)
    expect(JSON.parse(rs.rows[0].score_json as string).verdict).toBe('good fit')
  })

  it('leaves sub-threshold jobs at scored', async () => {
    const db = await tmpDb()
    await seedJob(db, 'a:1', 'A', '2026-08-10')
    await runJudge(db, config, profile, invokeWith(5), NOW)
    const rs = await db.execute("SELECT status FROM jobs WHERE external_key='a:1'")
    expect(rs.rows[0].status).toBe('scored')
  })

  it('respects scoreCapPerHunt, newest first', async () => {
    const db = await tmpDb()
    await seedJob(db, 'a:1', 'A', '2026-08-01')
    await seedJob(db, 'a:2', 'B', '2026-08-09')
    await seedJob(db, 'a:3', 'C', '2026-08-10')
    const res = await runJudge(db, config, profile, invokeWith(5), NOW)
    expect(res.scored).toBe(2)
    const rs = await db.execute("SELECT status FROM jobs WHERE external_key='a:1'")
    expect(rs.rows[0].status).toBe('matched')
  })

  it('does not queue a company inside the cooldown window', async () => {
    const db = await tmpDb()
    await seedJob(db, 'a:0', 'A', '2026-08-01', 'submitted', '2026-08-05T00:00:00Z')
    await seedJob(db, 'a:1', 'A', '2026-08-10')
    const res = await runJudge(db, config, profile, invokeWith(9), NOW)
    expect(res.queued).toBe(0)
    const rs = await db.execute("SELECT status FROM jobs WHERE external_key='a:1'")
    expect(rs.rows[0].status).toBe('scored')
  })

  it('marks jobs score_failed when invocation fails', async () => {
    const db = await tmpDb()
    await seedJob(db, 'a:1', 'A', '2026-08-10')
    const res = await runJudge(db, config, profile, invokeWith(new Error('quota')), NOW)
    expect(res).toEqual({ scored: 0, queued: 0, failed: 1 })
    const rs = await db.execute("SELECT status, score_json FROM jobs WHERE external_key='a:1'")
    expect(rs.rows[0].status).toBe('score_failed')
    expect(rs.rows[0].score_json as string).toContain('quota')
  })
})

describe('scoreSchema bounds', () => {
  it('accepts 0 for a job the judge rates as no fit at all', () => {
    const parsed = scoreSchema.parse({ score: 0, matched_strengths: [], gaps: ['wrong stack'], verdict: 'no' })
    expect(parsed.score).toBe(0)
  })

  it('still rejects a score above 10', () => {
    expect(() => scoreSchema.parse({ score: 11, matched_strengths: [], gaps: [], verdict: 'x' })).toThrow()
  })

  it('still rejects a negative score', () => {
    expect(() => scoreSchema.parse({ score: -1, matched_strengths: [], gaps: [], verdict: 'x' })).toThrow()
  })
})
