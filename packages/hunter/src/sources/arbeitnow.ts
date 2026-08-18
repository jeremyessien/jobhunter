import type { RawJob } from '../types'
import type { AdapterCtx, SourceAdapter } from './types'

export const ARBEITNOW_PAGES = 10

type ArbeitnowJob = {
  slug: string
  company_name: string
  title: string
  description: string
  remote: boolean
  url: string
  location?: string
  created_at?: number
}

export const arbeitnowAdapter: SourceAdapter = {
  name: 'arbeitnow',
  async fetchJobs(ctx: AdapterCtx): Promise<RawJob[]> {
    const jobs: RawJob[] = []
    for (let page = 1; page <= ARBEITNOW_PAGES; page++) {
      let batch: ArbeitnowJob[]
      try {
        const data = (await ctx.fetchJson(
          `https://www.arbeitnow.com/api/job-board-api?page=${page}`,
        )) as { data?: ArbeitnowJob[] }
        batch = Array.isArray(data.data) ? data.data : []
      } catch {
        continue
      }
      if (batch.length === 0) break
      for (const j of batch) {
        jobs.push({
          externalId: j.slug,
          title: j.title,
          company: j.company_name,
          location: j.location,
          remote: j.remote === true,
          description: j.description,
          applyUrl: j.url,
          source: 'arbeitnow',
          postedAt: j.created_at ? new Date(j.created_at * 1000).toISOString() : undefined,
        })
      }
    }
    return jobs
  },
}
