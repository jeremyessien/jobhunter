import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '@jobhunter/core'
import { ingestJobs, stripHtml } from '../src/pipeline/ingest.js'
import type { RawJob } from '../src/types.js'

const NOW = '2026-08-11T09:00:00Z'
const tmpDb = () => openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))

const base: RawJob = {
  externalId: '123',
  title: 'Senior Flutter Engineer',
  company: 'Acme',
  description: 'Build apps',
  applyUrl: 'https://boards.greenhouse.io/acme/jobs/123',
  source: 'greenhouse',
  atsFamily: 'greenhouse',
}

describe('stripHtml', () => {
  it('removes tags and decodes basic entities', () => {
    expect(stripHtml('<p>Dart &amp; Flutter</p>')).toBe('Dart & Flutter')
  })
})

describe('ingestJobs', () => {
  it('inserts new jobs with status sourced', async () => {
    const db = await tmpDb()
    const res = await ingestJobs(db, [base], NOW)
    expect(res).toEqual({ inserted: 1, updated: 0, skipped: 0 })
    const rs = await db.execute('SELECT status, external_key FROM jobs')
    expect(rs.rows[0].status).toBe('sourced')
    expect(rs.rows[0].external_key).toBe('greenhouse:123')
  })

  it('updates an existing job by external key instead of duplicating', async () => {
    const db = await tmpDb()
    await ingestJobs(db, [base], NOW)
    const res = await ingestJobs(db, [{ ...base, description: 'Updated' }], NOW)
    expect(res.updated).toBe(1)
    const rs = await db.execute('SELECT COUNT(*) AS n FROM jobs')
    expect(rs.rows[0].n).toBe(1)
  })

  it('prefers direct-ATS record over aggregator duplicate of same company+title', async () => {
    const db = await tmpDb()
    const aggregator: RawJob = { ...base, externalId: 'r9', source: 'remotive', atsFamily: undefined, applyUrl: 'https://remotive.com/j/9' }
    await ingestJobs(db, [aggregator], NOW)
    const res = await ingestJobs(db, [base], NOW)
    expect(res.updated).toBe(1)
    const rs = await db.execute('SELECT source, apply_url, COUNT(*) OVER () AS n FROM jobs')
    expect(rs.rows[0].n).toBe(1)
    expect(rs.rows[0].source).toBe('greenhouse')
  })

  it('skips aggregator duplicate when direct-ATS record already exists', async () => {
    const db = await tmpDb()
    await ingestJobs(db, [base], NOW)
    const aggregator: RawJob = { ...base, externalId: 'r9', source: 'remotive', atsFamily: undefined, applyUrl: 'https://remotive.com/j/9' }
    const res = await ingestJobs(db, [aggregator], NOW)
    expect(res.skipped).toBe(1)
  })

  it('normalizes whitespace in title and company for consistent deduping', async () => {
    const db = await tmpDb()
    const withWhitespace: RawJob = { ...base, externalId: 'r9', source: 'remotive', title: '  Senior Flutter Engineer  ', company: '  Acme  ', atsFamily: undefined, applyUrl: 'https://remotive.com/j/9' }
    await ingestJobs(db, [withWhitespace], NOW)
    const res = await ingestJobs(db, [base], NOW)
    expect(res.updated).toBe(1)
    const rs = await db.execute('SELECT source, COUNT(*) OVER () AS n FROM jobs')
    expect(rs.rows[0].n).toBe(1)
    expect(rs.rows[0].source).toBe('greenhouse')
  })
})
