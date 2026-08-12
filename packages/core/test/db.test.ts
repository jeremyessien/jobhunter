import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db.js'

const tmpUrl = () => 'file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 'test.db')

describe('openDb', () => {
  it('creates all tables', async () => {
    const db = await openDb(tmpUrl())
    const rs = await db.execute("SELECT name FROM sqlite_master WHERE type='table'")
    const names = rs.rows.map((r) => r.name)
    for (const t of ['companies', 'jobs', 'runs', 'profile']) expect(names).toContain(t)
  })

  it('is idempotent when opened twice on the same file', async () => {
    const url = tmpUrl()
    await openDb(url)
    const db = await openDb(url)
    await db.execute("INSERT INTO companies(ats, slug) VALUES ('greenhouse', 'stripe')")
    const rs = await db.execute('SELECT COUNT(*) AS n FROM companies')
    expect(rs.rows[0].n).toBe(1)
  })

  it('enforces unique jobs.external_key', async () => {
    const db = await openDb(tmpUrl())
    const sql =
      "INSERT INTO jobs(external_key, title, company, description, apply_url, source, first_seen) VALUES ('a:1','t','c','d','u','s','2026-08-11')"
    await db.execute(sql)
    await expect(db.execute(sql)).rejects.toThrow()
  })

  it('has the snoozed_until column on jobs', async () => {
    const db = await openDb(tmpUrl())
    const rs = await db.execute("SELECT name FROM pragma_table_info('jobs') WHERE name='snoozed_until'")
    expect(rs.rows).toHaveLength(1)
  })
})
