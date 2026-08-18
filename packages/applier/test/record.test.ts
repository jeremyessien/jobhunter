import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '@jobhunter/core'
import { markSubmitted, markExpired, cooldownBlocked, screenshotPath } from '../src/record'

const NOW = '2026-08-13T12:00:00Z'
const tmpDb = () => openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))

async function seed(db: Awaited<ReturnType<typeof tmpDb>>, over: Record<string, unknown> = {}) {
  const cols = {
    external_key: 'k:' + Math.random().toString(36).slice(2),
    title: 'Engineer',
    company: 'Acme',
    description: 'd',
    apply_url: 'https://x/apply',
    source: 's',
    first_seen: NOW,
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

describe('markSubmitted', () => {
  it('moves an approved job to submitted with the timestamp', async () => {
    const db = await tmpDb()
    const id = await seed(db)
    expect(await markSubmitted(db, id, NOW)).toBe(true)
    const row = (await db.execute({ sql: 'SELECT status, submitted_at FROM jobs WHERE id=?', args: [id] })).rows[0]
    expect(row.status).toBe('submitted')
    expect(row.submitted_at).toBe(NOW)
  })
  it('refuses jobs that are not approved', async () => {
    const db = await tmpDb()
    const id = await seed(db, { status: 'queued' })
    expect(await markSubmitted(db, id, NOW)).toBe(false)
    const row = (await db.execute({ sql: 'SELECT status FROM jobs WHERE id=?', args: [id] })).rows[0]
    expect(row.status).toBe('queued')
  })
})

describe('cooldownBlocked', () => {
  it('blocks when the same company was submitted to within the window', async () => {
    const db = await tmpDb()
    await seed(db, { status: 'submitted', submitted_at: '2026-08-10T00:00:00Z' })
    expect(await cooldownBlocked(db, 'acme', NOW, 14)).toBe(true)
    expect(await cooldownBlocked(db, 'Acme', NOW, 2)).toBe(false)
    expect(await cooldownBlocked(db, 'Other', NOW, 14)).toBe(false)
  })
})

describe('screenshotPath', () => {
  it('builds a per-job path inside the session dir', () => {
    expect(screenshotPath('applier-sessions/2026-08-13', 42, 'confirm')).toBe('applier-sessions/2026-08-13/42-confirm.png')
  })
})
describe('markExpired', () => {
  it('takes an approved job out of the queue', async () => {
    const db = await tmpDb()
    const id = await seed(db)
    expect(await markExpired(db, id)).toBe(true)
    const rs = await db.execute({ sql: 'SELECT status FROM jobs WHERE id=?', args: [id] })
    expect(rs.rows[0].status).toBe('expired')
  })

  it('leaves a submitted job alone', async () => {
    const db = await tmpDb()
    const id = await seed(db, { status: 'submitted' })
    expect(await markExpired(db, id)).toBe(false)
    const rs = await db.execute({ sql: 'SELECT status FROM jobs WHERE id=?', args: [id] })
    expect(rs.rows[0].status).toBe('submitted')
  })
})
