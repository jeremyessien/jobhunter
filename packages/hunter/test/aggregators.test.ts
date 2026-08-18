import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, configSchema } from '@jobhunter/core'
import { arbeitnowAdapter, ARBEITNOW_PAGES } from '../src/sources/arbeitnow.js'
import { remoteokAdapter } from '../src/sources/remoteok.js'
import { jobicyAdapter } from '../src/sources/jobicy.js'

const config = configSchema.parse({ lanes: [{ id: 'x', titlePatterns: ['a'], rule: 'any' }] })
const tmpDb = () => openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))

const ctx = async (fetchJson: (url: string) => Promise<unknown>) => ({
  db: await tmpDb(),
  config,
  fetchJson,
})

describe('arbeitnowAdapter', () => {
  const page = (n: number) => ({
    data: [
      {
        slug: `job-${n}`,
        company_name: 'Preiswecker',
        title: 'Senior Flutter Engineer',
        description: '<p>Build mobile apps</p>',
        remote: true,
        url: 'https://www.arbeitnow.com/jobs/companies/preiswecker/job-1',
        location: 'Berlin',
        created_at: 1786516800,
      },
    ],
  })

  it('walks every page and maps to RawJobs', async () => {
    const urls: string[] = []
    const jobs = await arbeitnowAdapter.fetchJobs(
      await ctx(async (url) => {
        urls.push(url)
        return page(urls.length)
      }),
    )
    expect(urls).toHaveLength(ARBEITNOW_PAGES)
    expect(urls[0]).toBe('https://www.arbeitnow.com/api/job-board-api?page=1')
    expect(jobs).toHaveLength(ARBEITNOW_PAGES)
    expect(jobs[0]).toMatchObject({
      externalId: 'job-1',
      title: 'Senior Flutter Engineer',
      company: 'Preiswecker',
      location: 'Berlin',
      remote: true,
      source: 'arbeitnow',
      applyUrl: 'https://www.arbeitnow.com/jobs/companies/preiswecker/job-1',
    })
  })

  it('uses the posting url the API supplies rather than a constructed one', async () => {
    const jobs = await arbeitnowAdapter.fetchJobs(await ctx(async () => page(1)))
    expect(jobs.every((j) => j.applyUrl === 'https://www.arbeitnow.com/jobs/companies/preiswecker/job-1')).toBe(true)
  })

  it('stops early when a page comes back empty', async () => {
    let calls = 0
    const jobs = await arbeitnowAdapter.fetchJobs(
      await ctx(async () => {
        calls++
        return calls === 1 ? page(1) : { data: [] }
      }),
    )
    expect(calls).toBe(2)
    expect(jobs).toHaveLength(1)
  })

  it('keeps going when one page fails', async () => {
    let calls = 0
    const jobs = await arbeitnowAdapter.fetchJobs(
      await ctx(async () => {
        calls++
        if (calls === 1) throw new Error('502')
        return page(calls)
      }),
    )
    expect(jobs.length).toBe(ARBEITNOW_PAGES - 1)
  })

  it('converts the unix timestamp to an ISO date', async () => {
    const jobs = await arbeitnowAdapter.fetchJobs(await ctx(async () => page(1)))
    expect(jobs[0].postedAt).toBe(new Date(1786516800 * 1000).toISOString())
  })
})

describe('remoteokAdapter', () => {
  const feed = [
    { legal: 'notice row with no position' },
    {
      id: '1136899',
      slug: 'senior-flutter-engineer-acme-1136899',
      position: 'Senior Flutter Engineer',
      company: 'Acme',
      description: 'Build things',
      location: 'Worldwide',
      date: '2026-08-17T10:54:02+00:00',
      apply_url: 'https://remoteOK.com/remote-jobs/senior-flutter-engineer-acme-1136899',
      salary_min: 120000,
      salary_max: 150000,
    },
  ]

  it('skips the legal preamble row and maps the rest', async () => {
    const jobs = await remoteokAdapter.fetchJobs(await ctx(async () => feed))
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      externalId: '1136899',
      title: 'Senior Flutter Engineer',
      company: 'Acme',
      remote: true,
      source: 'remoteok',
      salary: '120000-150000',
    })
  })

  it('omits salary when the feed reports zeros', async () => {
    const jobs = await remoteokAdapter.fetchJobs(
      await ctx(async () => [{ ...feed[1], salary_min: 0, salary_max: 0 }]),
    )
    expect(jobs[0].salary).toBeUndefined()
  })
})

describe('jobicyAdapter', () => {
  const feed = {
    jobs: [
      {
        id: 145717,
        url: 'https://jobicy.com/jobs/145717-senior-flutter-engineer',
        jobTitle: 'Senior Flutter Engineer',
        companyName: 'Ashby',
        jobGeo: 'Canada,  USA',
        jobDescription: '<p>Build things</p>',
        pubDate: '2026-08-18T03:15:03+00:00',
        salaryMin: 80000,
        salaryMax: 120000,
        salaryCurrency: 'USD',
      },
    ],
  }

  it('maps the remote-jobs feed to RawJobs', async () => {
    const urls: string[] = []
    const jobs = await jobicyAdapter.fetchJobs(
      await ctx(async (url) => {
        urls.push(url)
        return feed
      }),
    )
    expect(urls).toEqual(['https://jobicy.com/api/v2/remote-jobs?count=100'])
    expect(jobs[0]).toMatchObject({
      externalId: '145717',
      title: 'Senior Flutter Engineer',
      company: 'Ashby',
      location: 'Canada,  USA',
      remote: true,
      source: 'jobicy',
      salary: '80000-120000 USD',
      applyUrl: 'https://jobicy.com/jobs/145717-senior-flutter-engineer',
    })
  })

  it('returns an empty list when the feed has no jobs array', async () => {
    const jobs = await jobicyAdapter.fetchJobs(await ctx(async () => ({})))
    expect(jobs).toEqual([])
  })
})
