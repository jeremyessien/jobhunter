import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, configSchema } from '@jobhunter/core'
import { greenhouseAdapter } from '../src/sources/greenhouse.js'

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'greenhouse-jobs.json'), 'utf8'),
)
const config = configSchema.parse({ lanes: [{ id: 'x', titlePatterns: ['a'], rule: 'any' }] })

describe('greenhouseAdapter', () => {
  it('fetches jobs for every seeded greenhouse company and maps fields', async () => {
    const db = await openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))
    await db.execute("INSERT INTO companies(ats, slug, name) VALUES ('greenhouse','acme','Acme'), ('lever','other','Other')")
    const urls: string[] = []
    const jobs = await greenhouseAdapter.fetchJobs({
      db, config,
      fetchJson: async (url) => { urls.push(url); return fixture },
    })
    expect(urls).toEqual(['https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true'])
    expect(jobs).toHaveLength(2)
    expect(jobs[0]).toMatchObject({
      externalId: '4011002',
      title: 'Senior Flutter Engineer',
      company: 'Acme',
      location: 'Remote',
      applyUrl: 'https://boards.greenhouse.io/acme/jobs/4011002',
      source: 'greenhouse',
      atsFamily: 'greenhouse',
    })
    expect(jobs[0].description).toContain('<p>Build our mobile app')
  })

  it('continues past a failing company', async () => {
    const db = await openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))
    await db.execute("INSERT INTO companies(ats, slug) VALUES ('greenhouse','dead'), ('greenhouse','acme')")
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const jobs = await greenhouseAdapter.fetchJobs({
      db, config,
      fetchJson: async (url) => {
        if (url.includes('dead')) throw new Error('404')
        return fixture
      },
    })
    expect(jobs).toHaveLength(2)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('dead'))
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('404'))
    errorSpy.mockRestore()
  })
})
