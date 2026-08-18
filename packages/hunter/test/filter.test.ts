import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, configSchema } from '@jobhunter/core'
import { matchLane, runFilter } from '../src/pipeline/filter.js'
import { ingestJobs } from '../src/pipeline/ingest.js'
import type { RawJob } from '../src/types.js'

const config = configSchema.parse({
  blocklist: ['evilcorp'],
  lanes: [
    { id: 'remote-mobile', titlePatterns: ['flutter', 'mobile'], rule: 'remote' },
    { id: 'visa-anywhere', titlePatterns: ['flutter', 'frontend'], rule: 'visa' },
    { id: 'nigeria-local', titlePatterns: ['software engineer', 'frontend'], rule: 'nigeria' },
  ],
})

const job = (over: Partial<Parameters<typeof matchLane>[0]>) => ({
  title: 'Senior Flutter Engineer',
  company: 'Acme',
  location: 'Remote',
  remote: 1,
  description: 'Work from anywhere.',
  ...over,
})

describe('matchLane', () => {
  it('matches a senior remote flutter role to remote-mobile', () => {
    expect(matchLane(job({}), config)).toBe('remote-mobile')
  })
  it('rejects non-senior titles', () => {
    expect(matchLane(job({ title: 'Junior Flutter Developer' }), config)).toBeNull()
  })
  it('rejects blocklisted companies', () => {
    expect(matchLane(job({ company: 'EvilCorp' }), config)).toBeNull()
  })
  it('rejects remote roles restricted to the US', () => {
    expect(matchLane(job({ description: 'Remote, US only.' }), config)).toBeNull()
  })
  it('matches an onsite role mentioning visa sponsorship to visa-anywhere', () => {
    const j = job({ title: 'Senior Frontend Engineer', location: 'Berlin', remote: 0, description: 'We offer visa sponsorship.' })
    expect(matchLane(j, config)).toBe('visa-anywhere')
  })
  it('matches a Lagos role to nigeria-local', () => {
    const j = job({ title: 'Senior Software Engineer', location: 'Lagos, Nigeria', remote: 0 })
    expect(matchLane(j, config)).toBe('nigeria-local')
  })
  it('returns null when nothing applies', () => {
    expect(matchLane(job({ title: 'Senior Accountant' }), config)).toBeNull()
  })
})

describe('runFilter', () => {
  it('splits sourced jobs into matched and filtered_out', async () => {
    const db = await openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))
    const raws: RawJob[] = [
      { externalId: '1', title: 'Senior Flutter Engineer', company: 'A', description: 'Anywhere', applyUrl: 'u1', source: 's', remote: true, location: 'Remote' },
      { externalId: '2', title: 'Senior Accountant', company: 'B', description: 'x', applyUrl: 'u2', source: 's' },
    ]
    await ingestJobs(db, raws, '2026-08-11T09:00:00Z')
    const res = await runFilter(db, config)
    expect(res).toEqual({ matched: 1, filteredOut: 1 })
    const rs = await db.execute("SELECT status, lane FROM jobs WHERE external_key='s:1'")
    expect(rs.rows[0].status).toBe('matched')
    expect(rs.rows[0].lane).toBe('remote-mobile')
  })
})

describe('loosened matching', () => {
  const open = configSchema.parse({
    lanes: [
      { id: 'remote-mobile', titlePatterns: ['flutter', 'mobile'], seniorityPatterns: [], rule: 'remote' },
      { id: 'visa-anywhere', titlePatterns: ['flutter', 'mobile'], seniorityPatterns: [], rule: 'visa' },
    ],
  })

  it('accepts a title with no seniority word when the lane asks for none', () => {
    expect(matchLane(job({ title: 'Flutter Developer' }), open)).toBe('remote-mobile')
  })

  it('still rejects junior and intern titles', () => {
    for (const title of [
      'Junior Flutter Developer',
      'Flutter Engineer Intern',
      'Werkstudent Mobile Development (m/w/d)',
      'Graduate Mobile Engineer',
    ]) {
      expect(matchLane(job({ title }), open)).toBeNull()
    }
  })

  it('matches a partial title like "Software Engineer III Mobile"', () => {
    expect(matchLane(job({ title: 'Software Engineer III Mobile' }), open)).toBe('remote-mobile')
  })

  it('routes an onsite German role to visa-anywhere on location alone', () => {
    const j = job({
      title: 'Mobile Engineer - Flutter',
      location: 'Berlin, Berlin, Germany',
      remote: 0,
      description: 'Join our team in Berlin.',
    })
    expect(matchLane(j, open)).toBe('visa-anywhere')
  })

  it('still honours an explicit sponsorship mention outside the country list', () => {
    const j = job({
      title: 'Flutter Engineer',
      location: 'Tokyo, Japan',
      remote: 0,
      description: 'We offer visa sponsorship.',
    })
    expect(matchLane(j, open)).toBe('visa-anywhere')
  })

  it('does not route an onsite role in a non-sponsoring location', () => {
    const j = job({
      title: 'Flutter Engineer',
      location: 'Pittsburgh, PA',
      remote: 0,
      description: 'Onsite only.',
    })
    expect(matchLane(j, open)).toBeNull()
  })
})
