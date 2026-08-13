import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '@jobhunter/core'
import { approvedJobs, resolveGreenhouse } from '../src/apply'

const tmpDb = () => openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))

async function seed(db: Awaited<ReturnType<typeof tmpDb>>, over: Record<string, unknown> = {}) {
  const cols = {
    external_key: 'greenhouse:' + Math.floor(Math.random() * 1e9),
    title: 'Engineer',
    company: 'Acme',
    description: 'd',
    apply_url: 'https://boards.greenhouse.io/acme/jobs/1',
    source: 's',
    first_seen: '2026-08-13T00:00:00Z',
    status: 'approved',
    ...over,
  }
  const keys = Object.keys(cols)
  await db.execute({
    sql: `INSERT INTO jobs(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
    args: Object.values(cols) as never[],
  })
  return Number((await db.execute('SELECT last_insert_rowid() AS id')).rows[0].id)
}

describe('approvedJobs', () => {
  it('returns only approved jobs, oldest first, with parsed drafts', async () => {
    const db = await tmpDb()
    await seed(db, {
      first_seen: '2026-08-12T00:00:00Z',
      title: 'Older',
      cover_letter: 'Dear',
      answers_json: '[{"question":"Q","answer":"A"}]',
    })
    await seed(db, { title: 'Newer' })
    await seed(db, { status: 'queued' })
    await seed(db, { status: 'submitted' })
    const jobs = await approvedJobs(db)
    expect(jobs.map((j) => j.title)).toEqual(['Older', 'Newer'])
    expect(jobs[0].coverLetter).toBe('Dear')
    expect(jobs[0].answers).toEqual([{ question: 'Q', answer: 'A' }])
    expect(jobs[1].answers).toEqual([])
  })
})

describe('resolveGreenhouse', () => {
  it('resolves slug and id straight from a hosted board url', async () => {
    const db = await tmpDb()
    const id = await seed(db, { apply_url: 'https://job-boards.greenhouse.io/twilio/jobs/8039842' })
    const jobs = await approvedJobs(db)
    const job = jobs.find((j) => j.id === id)!
    expect(await resolveGreenhouse(db, job)).toEqual({ slug: 'twilio', id: '8039842' })
  })
  it('falls back to external_key id and the companies table for custom domains', async () => {
    const db = await tmpDb()
    await db.execute("INSERT INTO companies(ats, slug, name) VALUES ('greenhouse', 'brex', 'Brex')")
    const id = await seed(db, {
      external_key: 'greenhouse:8399566002',
      company: 'Brex',
      apply_url: 'https://www.brex.com/careers/8399566002?gh_jid=8399566002',
    })
    const jobs = await approvedJobs(db)
    const job = jobs.find((j) => j.id === id)!
    expect(await resolveGreenhouse(db, job)).toEqual({ slug: 'brex', id: '8399566002' })
  })
  it('matches company names case-insensitively', async () => {
    const db = await tmpDb()
    await db.execute("INSERT INTO companies(ats, slug, name) VALUES ('greenhouse', 'brex', 'BREX')")
    const id = await seed(db, {
      external_key: 'greenhouse:42',
      company: 'brex',
      apply_url: 'https://www.brex.com/careers/42',
    })
    const jobs = await approvedJobs(db)
    const job = jobs.find((j) => j.id === id)!
    expect(await resolveGreenhouse(db, job)).toEqual({ slug: 'brex', id: '42' })
  })
  it('returns null when the company is unknown and the url is not a board url', async () => {
    const db = await tmpDb()
    const id = await seed(db, {
      external_key: 'greenhouse:7',
      company: 'Mystery Co',
      apply_url: 'https://jobs.mystery.xyz/apply/7',
    })
    const jobs = await approvedJobs(db)
    const job = jobs.find((j) => j.id === id)!
    expect(await resolveGreenhouse(db, job)).toBeNull()
  })
  it('returns null for non-greenhouse external keys', async () => {
    const db = await tmpDb()
    const id = await seed(db, { external_key: 'remotive:99', apply_url: 'https://remotive.com/j/99' })
    const jobs = await approvedJobs(db)
    const job = jobs.find((j) => j.id === id)!
    expect(await resolveGreenhouse(db, job)).toBeNull()
  })
})