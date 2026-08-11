import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, configSchema } from '@jobhunter/core'
import { remotiveAdapter } from '../src/sources/remotive.js'

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'remotive-jobs.json'), 'utf8'),
)
const config = configSchema.parse({ lanes: [{ id: 'x', titlePatterns: ['a'], rule: 'any' }] })

describe('remotiveAdapter', () => {
  it('maps the software-dev feed to RawJobs', async () => {
    const db = await openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))
    const urls: string[] = []
    const jobs = await remotiveAdapter.fetchJobs({
      db, config,
      fetchJson: async (url) => { urls.push(url); return fixture },
    })
    expect(urls).toEqual(['https://remotive.com/api/remote-jobs?category=software-dev'])
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      externalId: '1917774',
      title: 'Senior Mobile Engineer',
      company: 'Acme Remote',
      location: 'Worldwide',
      remote: true,
      salary: '$120k-$150k',
      source: 'remotive',
      applyUrl: 'https://remotive.com/remote-jobs/software-dev/senior-mobile-engineer-1917774',
    })
    expect(jobs[0].atsFamily).toBeUndefined()
  })
})
