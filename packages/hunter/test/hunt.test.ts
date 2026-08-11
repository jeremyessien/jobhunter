import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, configSchema, type InvokeClaude } from '@jobhunter/core'
import { hunt } from '../src/hunt.js'
import type { SourceAdapter } from '../src/sources/types.js'

const NOW = '2026-08-11T09:00:00Z'
const config = configSchema.parse({
  lanes: [{ id: 'remote-mobile', titlePatterns: ['flutter'], rule: 'remote' }],
})

const goodAdapter: SourceAdapter = {
  name: 'good',
  fetchJobs: async () => [
    { externalId: '1', title: 'Senior Flutter Engineer', company: 'A', description: 'Anywhere', applyUrl: 'u', source: 'good', remote: true, location: 'Remote' },
  ],
}
const badAdapter: SourceAdapter = {
  name: 'bad',
  fetchJobs: async () => { throw new Error('API changed') },
}
const invoke = (async () => ({
  score: 8, matched_strengths: [{ claim: 'c', evidence: 'e' }], gaps: [], verdict: 'v',
})) as InvokeClaude

describe('hunt', () => {
  it('runs adapters in isolation, records runs, filters, and judges', async () => {
    const db = await openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))
    await db.execute({
      sql: "INSERT INTO profile(id, json, updated_at) VALUES (1, ?, ?)",
      args: [JSON.stringify({ name: 'J', email: 'j@x.com', location: 'Lagos', links: [], skills: [], experience: [], education: [], screening: {} }), NOW],
    })
    const result = await hunt({ db, config, adapters: [goodAdapter, badAdapter], invoke, fetchJson: async () => ({}), now: NOW })

    expect(result.runs).toEqual([
      { source: 'good', ok: true, jobsFound: 1 },
      { source: 'bad', ok: false, jobsFound: 0 },
    ])
    expect(result.filter).toEqual({ matched: 1, filteredOut: 0 })
    expect(result.judge).toEqual({ scored: 1, queued: 1, failed: 0 })

    const runs = await db.execute('SELECT source, ok, error FROM runs ORDER BY id')
    expect(runs.rows[0].ok).toBe(1)
    expect(runs.rows[1].ok).toBe(0)
    expect(runs.rows[1].error).toContain('API changed')
  })

  it('skips the judge when no profile exists', async () => {
    const db = await openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))
    const result = await hunt({ db, config, adapters: [goodAdapter], invoke, fetchJson: async () => ({}), now: NOW })
    expect(result.judge).toBeNull()
    const rs = await db.execute('SELECT status FROM jobs')
    expect(rs.rows[0].status).toBe('matched')
  })
})
