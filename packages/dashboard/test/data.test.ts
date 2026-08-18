import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '@jobhunter/core'
import { queueJobs, getJob, trackerJobs, laneStats, sourceHealth, queueOutlook } from '../lib/data.js'

const NOW = '2026-08-12T09:00:00Z'
const tmpDb = () => openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))

const scoreJson = JSON.stringify({
  score: 8,
  matched_strengths: [{ claim: 'Flutter depth', evidence: 'Cold start 11.4s to 2.1s' }],
  gaps: ['No Rust'],
  verdict: 'strong fit',
})

async function seed(db: Awaited<ReturnType<typeof tmpDb>>, over: Record<string, unknown> = {}) {
  const cols = {
    external_key: 'k:' + Math.random().toString(36).slice(2),
    title: 'Senior Flutter Engineer',
    company: 'Acme',
    description: 'Build apps',
    apply_url: 'https://x/apply',
    source: 's',
    first_seen: NOW,
    status: 'queued',
    score: 8,
    lane: 'remote-mobile',
    score_json: scoreJson,
    ...over,
  }
  const keys = Object.keys(cols)
  await db.execute({
    sql: `INSERT INTO jobs(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
    args: Object.values(cols) as never[],
  })
  const rs = await db.execute('SELECT last_insert_rowid() AS id')
  return Number(rs.rows[0].id)
}

describe('queueJobs', () => {
  it('lists queued jobs with parsed evidence, highest score first', async () => {
    const db = await tmpDb()
    await seed(db, { score: 7 })
    await seed(db, { score: 9, title: 'Senior Mobile Engineer' })
    await seed(db, { status: 'scored' })
    const q = await queueJobs(db, NOW)
    expect(q.map((j) => j.score)).toEqual([9, 7])
    expect(q[0].strengths[0].evidence).toContain('11.4s')
    expect(q[0].gaps).toEqual(['No Rust'])
    expect(q[0].verdict).toBe('strong fit')
  })

  it('hides snoozed jobs until the snooze expires', async () => {
    const db = await tmpDb()
    await seed(db, { snoozed_until: '2026-08-13T00:00:00Z' })
    await seed(db, { snoozed_until: '2026-08-11T00:00:00Z', title: 'Woken Job' })
    const q = await queueJobs(db, NOW)
    expect(q).toHaveLength(1)
    expect(q[0].title).toBe('Woken Job')
  })

  it('survives malformed score_json', async () => {
    const db = await tmpDb()
    await seed(db, { score_json: '{"error":"quota"}' })
    const q = await queueJobs(db, NOW)
    expect(q[0].verdict).toBe('')
    expect(q[0].strengths).toEqual([])
  })
})

describe('getJob', () => {
  it('returns full detail with parsed answers', async () => {
    const db = await tmpDb()
    const id = await seed(db, {
      cover_letter: 'A letter.',
      answers_json: JSON.stringify([{ question: 'Why?', answer: 'Because.' }]),
      draft_flag: 'drafted',
      updated_at: NOW,
    })
    const j = await getJob(db, id)
    expect(j?.coverLetter).toBe('A letter.')
    expect(j?.answers).toEqual([{ question: 'Why?', answer: 'Because.' }])
    expect(j?.updatedAt).toBe(NOW)
    expect(j?.status).toBe('queued')
  })

  it('returns null for a missing id', async () => {
    const db = await tmpDb()
    expect(await getJob(db, 999)).toBeNull()
  })
})

describe('trackerJobs + laneStats', () => {
  it('lists submitted-and-beyond jobs and computes per-lane stats', async () => {
    const db = await tmpDb()
    await seed(db, { status: 'submitted', submitted_at: '2026-08-10T00:00:00Z' })
    await seed(db, { status: 'responded', submitted_at: '2026-08-09T00:00:00Z', responded_at: NOW })
    await seed(db, { status: 'rejected', submitted_at: '2026-08-08T00:00:00Z', lane: 'nigeria-local' })
    await seed(db) // queued — excluded
    const t = await trackerJobs(db)
    expect(t.map((j) => j.status)).toEqual(['submitted', 'responded', 'rejected'])
    const stats = await laneStats(db)
    expect(stats).toContainEqual({ lane: 'remote-mobile', submitted: 2, responded: 1 })
    expect(stats).toContainEqual({ lane: 'nigeria-local', submitted: 1, responded: 0 })
  })
})

describe('sourceHealth', () => {
  it('computes consecutive failures and warns at three', async () => {
    const db = await tmpDb()
    const run = (source: string, ok: number, at: string) =>
      db.execute({
        sql: 'INSERT INTO runs(started_at, finished_at, source, ok, jobs_found) VALUES (?,?,?,?,0)',
        args: [at, at, source, ok],
      })
    await run('greenhouse', 1, '2026-08-10T00:00:00Z')
    await run('greenhouse', 0, '2026-08-11T00:00:00Z')
    await run('greenhouse', 0, '2026-08-11T12:00:00Z')
    await run('greenhouse', 0, '2026-08-12T00:00:00Z')
    await run('remotive', 0, '2026-08-11T00:00:00Z')
    await run('remotive', 1, '2026-08-12T00:00:00Z')
    const h = await sourceHealth(db)
    const gh = h.find((s) => s.source === 'greenhouse')
    const rm = h.find((s) => s.source === 'remotive')
    expect(gh).toMatchObject({ consecutiveFailures: 3, warning: true, lastOk: '2026-08-10T00:00:00Z' })
    expect(rm).toMatchObject({ consecutiveFailures: 0, warning: false })
  })
})

describe('queueOutlook', () => {
  it('reports scored-below-bar count, best score, and last hunt time', async () => {
    const db = await tmpDb()
    await seed(db, { status: 'scored', score: 6 })
    await seed(db, { status: 'scored', score: 4 })
    await seed(db, { status: 'queued', score: 8 })
    await seed(db, { status: 'filtered_out', score: null })
    const run = (source: string, at: string) =>
      db.execute({
        sql: 'INSERT INTO runs(started_at, finished_at, source, ok, jobs_found) VALUES (?,?,?,1,0)',
        args: [at, at, source],
      })
    await run('greenhouse', '2026-08-11T00:00:00Z')
    await run('remotive', '2026-08-12T06:00:00Z')
    const o = await queueOutlook(db)
    expect(o).toEqual({ scoredCount: 2, bestScore: 6, lastHuntAt: '2026-08-12T06:00:00Z' })
  })

  it('handles an empty database', async () => {
    const db = await tmpDb()
    const o = await queueOutlook(db)
    expect(o).toEqual({ scoredCount: 0, bestScore: null, lastHuntAt: null })
  })
})

const answers = (...flags: boolean[]) =>
  JSON.stringify(flags.map((f, i) => ({ question: `q${i}`, answer: `a${i}`, needs_you: f })))

describe('queueJobs readiness', () => {
  it('marks a gate-passing draft with no gaps as ready', async () => {
    const db = await tmpDb()
    await seed(db, { draft_flag: 'drafted', answers_json: answers(false, false) })
    const [job] = await queueJobs(db, NOW)
    expect(job.ready).toBe(true)
    expect(job.needsYouCount).toBe(0)
  })

  it('is not ready when any answer needs him', async () => {
    const db = await tmpDb()
    await seed(db, { draft_flag: 'drafted', answers_json: answers(false, true) })
    const [job] = await queueJobs(db, NOW)
    expect(job.ready).toBe(false)
    expect(job.needsYouCount).toBe(1)
  })

  it('is not ready when the draft was flagged manual', async () => {
    const db = await tmpDb()
    await seed(db, { draft_flag: 'manual', answers_json: answers(false) })
    const [job] = await queueJobs(db, NOW)
    expect(job.ready).toBe(false)
  })

  it('is not ready when there is no draft yet', async () => {
    const db = await tmpDb()
    await seed(db, { draft_flag: null, answers_json: null })
    const [job] = await queueJobs(db, NOW)
    expect(job.ready).toBe(false)
    expect(job.needsYouCount).toBe(0)
  })

  it('treats a legacy draft with no needs_you key as ready', async () => {
    const db = await tmpDb()
    await seed(db, {
      draft_flag: 'drafted',
      answers_json: JSON.stringify([{ question: 'q', answer: 'a' }]),
    })
    const [job] = await queueJobs(db, NOW)
    expect(job.ready).toBe(true)
  })

  it('survives malformed answers_json without throwing', async () => {
    const db = await tmpDb()
    await seed(db, { draft_flag: 'drafted', answers_json: '{not json' })
    const [job] = await queueJobs(db, NOW)
    expect(job.ready).toBe(true)
    expect(job.needsYouCount).toBe(0)
  })

  it('exposes readiness on the job detail too', async () => {
    const db = await tmpDb()
    const id = await seed(db, { draft_flag: 'drafted', answers_json: answers(true) })
    const job = await getJob(db, id)
    expect(job?.ready).toBe(false)
    expect(job?.needsYouCount).toBe(1)
  })
})
