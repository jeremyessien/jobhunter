import { describe, it, expect } from 'vitest'
import { checkPosting } from '../src/liveness.js'

const JOB = 'https://www.arbeitnow.com/jobs/companies/transperfect/mobile-engineer-flutter-berlin-313677'

const respond = (init: { status?: number; url?: string }) =>
  (async () => ({ status: init.status ?? 200, url: init.url ?? JOB })) as unknown as typeof fetch

describe('checkPosting', () => {
  it('calls the URL without downloading the body', async () => {
    const calls: [string, string | undefined][] = []
    const fetchImpl = (async (url: string, opts: { method?: string }) => {
      calls.push([url, opts?.method])
      return { status: 200, url: JOB }
    }) as unknown as typeof fetch
    await checkPosting(JOB, fetchImpl)
    expect(calls).toEqual([[JOB, 'HEAD']])
  })

  it('reports live when the posting still resolves to itself', async () => {
    expect(await checkPosting(JOB, respond({ status: 200 }))).toBe('live')
  })

  it('reports gone on 404 and 410', async () => {
    expect(await checkPosting(JOB, respond({ status: 404 }))).toBe('gone')
    expect(await checkPosting(JOB, respond({ status: 410 }))).toBe('gone')
  })

  it('reports gone when a 200 redirected to the site root', async () => {
    expect(await checkPosting(JOB, respond({ status: 200, url: 'https://www.arbeitnow.com/' }))).toBe('gone')
  })

  it('reports gone when a 200 redirected to a bare listing path', async () => {
    expect(await checkPosting(JOB, respond({ status: 200, url: 'https://www.arbeitnow.com/jobs' }))).toBe('gone')
  })

  it('reports gone when a closed posting lands on a search page', async () => {
    // a closed Greenhouse job redirects to the employer's search page, keeping
    // the gh_jid query but losing the posting itself
    const search = 'https://stripe.com/careers/search?gh_jid=8062708'
    expect(await checkPosting(JOB, respond({ status: 200, url: search }))).toBe('gone')
  })

  it('stays live for an open posting that lands on a specific listing', async () => {
    const listing = 'https://stripe.com/careers/listing/mobile-engineer-treasury/7978915?gh_jid=7978915'
    expect(await checkPosting(JOB, respond({ status: 200, url: listing }))).toBe('live')
  })

  it('stays live when a redirect keeps a deep path', async () => {
    const moved = 'https://boards.greenhouse.io/stripe/jobs/7182930'
    expect(await checkPosting(JOB, respond({ status: 200, url: moved }))).toBe('live')
  })

  it('reports unknown when the site blocks the check', async () => {
    expect(await checkPosting(JOB, respond({ status: 403 }))).toBe('unknown')
    expect(await checkPosting(JOB, respond({ status: 405 }))).toBe('unknown')
  })

  it('reports unknown on a server error rather than condemning the posting', async () => {
    expect(await checkPosting(JOB, respond({ status: 500 }))).toBe('unknown')
  })

  it('reports unknown when the request throws', async () => {
    const boom = (async () => {
      throw new Error('ETIMEDOUT')
    }) as unknown as typeof fetch
    expect(await checkPosting(JOB, boom)).toBe('unknown')
  })

  it('reports unknown for a URL it cannot parse', async () => {
    expect(await checkPosting('not-a-url', respond({ status: 200 }))).toBe('unknown')
  })
})
