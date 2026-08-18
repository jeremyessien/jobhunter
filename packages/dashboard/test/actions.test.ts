import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '@jobhunter/core'
import { approveJob, approveAllReady, skipJob, snoozeJob, markSubmitted, tagResponded, tagRejected, saveDraft } from '../lib/actions.js'

const NOW = '2026-08-12T09:00:00Z'
const tmpDb = () => openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))

async function seed(db: Awaited<ReturnType<typeof tmpDb>>, status = 'queued') {
  await db.execute({
    sql: `INSERT INTO jobs(external_key, title, company, description, apply_url, source, first_seen, status, lane)
          VALUES ('k:' || abs(random()), 'Senior Flutter Engineer','Acme','Build apps with 11.4s to 2.1s budgets','u','s',?,?,'x')`,
    args: [NOW, status],
  })
  const rs = await db.execute('SELECT last_insert_rowid() AS id')
  return Number(rs.rows[0].id)
}

const status = async (db: Awaited<ReturnType<typeof tmpDb>>, id: number) =>
  String((await db.execute({ sql: 'SELECT status FROM jobs WHERE id=?', args: [id] })).rows[0].status)

describe('status transitions', () => {
  it('approves only queued jobs', async () => {
    const db = await tmpDb()
    const id = await seed(db)
    expect(await approveJob(db, id)).toBe(true)
    expect(await status(db, id)).toBe('approved')
    expect(await approveJob(db, id)).toBe(false)
  })

  it('skips a queued job to rejected', async () => {
    const db = await tmpDb()
    const id = await seed(db)
    expect(await skipJob(db, id)).toBe(true)
    expect(await status(db, id)).toBe('rejected')
  })

  it('snoozes by setting snoozed_until without changing status', async () => {
    const db = await tmpDb()
    const id = await seed(db)
    expect(await snoozeJob(db, id, 3, NOW)).toBe(true)
    const rs = await db.execute({ sql: 'SELECT status, snoozed_until FROM jobs WHERE id=?', args: [id] })
    expect(rs.rows[0].status).toBe('queued')
    expect(rs.rows[0].snoozed_until).toBe('2026-08-15T09:00:00.000Z')
  })

  it('marks approved jobs submitted with a timestamp', async () => {
    const db = await tmpDb()
    const id = await seed(db, 'approved')
    expect(await markSubmitted(db, id, NOW)).toBe(true)
    const rs = await db.execute({ sql: 'SELECT status, submitted_at FROM jobs WHERE id=?', args: [id] })
    expect(rs.rows[0].status).toBe('submitted')
    expect(rs.rows[0].submitted_at).toBe(NOW)
  })

  it('tags submitted jobs responded or rejected', async () => {
    const db = await tmpDb()
    const a = await seed(db, 'submitted')
    expect(await tagResponded(db, a, NOW)).toBe(true)
    expect(await status(db, a)).toBe('responded')
    const b = await seed(db, 'submitted')
    expect(await tagRejected(db, b)).toBe(true)
    expect(await status(db, b)).toBe('rejected')
  })
})

describe('saveDraft', () => {
  it('stores the edit, sets draft_flag, and returns no warnings for clean text', async () => {
    const db = await tmpDb()
    const id = await seed(db)
    const warnings = await saveDraft(db, id, 'I ship reliable apps.', [{ question: 'Why?', answer: 'Because I do.' }])
    expect(warnings).toEqual([])
    const rs = await db.execute({ sql: 'SELECT cover_letter, answers_json, draft_flag FROM jobs WHERE id=?', args: [id] })
    expect(rs.rows[0].cover_letter).toBe('I ship reliable apps.')
    expect(JSON.parse(String(rs.rows[0].answers_json))).toEqual([{ question: 'Why?', answer: 'Because I do.' }])
    expect(rs.rows[0].draft_flag).toBe('drafted')
  })

  it('stores anyway but returns gate warnings for violating text', async () => {
    const db = await tmpDb()
    const id = await seed(db)
    const warnings = await saveDraft(db, id, 'I am thrilled — I boosted revenue 82%.', [])
    expect(warnings.some((w) => w.includes('em-dash'))).toBe(true)
    expect(warnings.some((w) => w.includes('82'))).toBe(true)
    const rs = await db.execute({ sql: 'SELECT cover_letter FROM jobs WHERE id=?', args: [id] })
    expect(String(rs.rows[0].cover_letter)).toContain('82%')
  })

  it('lets numbers from the job description pass fact-lock', async () => {
    const db = await tmpDb()
    const id = await seed(db)
    const warnings = await saveDraft(db, id, 'Your 11.4s to 2.1s budget matches my experience.', [])
    expect(warnings).toEqual([])
  })
})

const withDraft = async (
  db: Awaited<ReturnType<typeof tmpDb>>,
  flag: string | null,
  gaps: boolean[],
  extra: Record<string, unknown> = {},
) => {
  const id = await seed(db)
  await db.execute({
    sql: 'UPDATE jobs SET draft_flag=?, answers_json=?, snoozed_until=? WHERE id=?',
    args: [
      flag,
      JSON.stringify(gaps.map((g, i) => ({ question: `q${i}`, answer: `a${i}`, needs_you: g }))),
      (extra.snoozed_until as string) ?? null,
      id,
    ],
  })
  return id
}

describe('approveAllReady', () => {
  it('approves ready jobs and leaves everything else queued', async () => {
    const db = await tmpDb()
    const ready = await withDraft(db, 'drafted', [false, false])
    const gap = await withDraft(db, 'drafted', [false, true])
    const manual = await withDraft(db, 'manual', [false])

    expect(await approveAllReady(db, NOW)).toBe(1)
    expect(await status(db, ready)).toBe('approved')
    expect(await status(db, gap)).toBe('queued')
    expect(await status(db, manual)).toBe('queued')
  })

  it('skips snoozed jobs even when their draft is clean', async () => {
    const db = await tmpDb()
    await withDraft(db, 'drafted', [false], { snoozed_until: '2026-09-01T00:00:00Z' })
    expect(await approveAllReady(db, NOW)).toBe(0)
  })

  it('returns zero when nothing is ready', async () => {
    const db = await tmpDb()
    await withDraft(db, 'manual', [false])
    expect(await approveAllReady(db, NOW)).toBe(0)
  })

  it('is idempotent - a second sweep approves nothing more', async () => {
    const db = await tmpDb()
    await withDraft(db, 'drafted', [false])
    expect(await approveAllReady(db, NOW)).toBe(1)
    expect(await approveAllReady(db, NOW)).toBe(0)
  })
})
