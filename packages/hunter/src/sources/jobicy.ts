import type { RawJob } from '../types'
import type { AdapterCtx, SourceAdapter } from './types'

type JobicyJob = {
  id: number | string
  url: string
  jobTitle: string
  companyName: string
  jobGeo?: string
  jobDescription?: string
  jobExcerpt?: string
  pubDate?: string
  salaryMin?: number
  salaryMax?: number
  salaryCurrency?: string
}

const salary = (j: JobicyJob) =>
  j.salaryMin && j.salaryMax
    ? `${j.salaryMin}-${j.salaryMax}${j.salaryCurrency ? ` ${j.salaryCurrency}` : ''}`
    : undefined

export const jobicyAdapter: SourceAdapter = {
  name: 'jobicy',
  async fetchJobs(ctx: AdapterCtx): Promise<RawJob[]> {
    const data = (await ctx.fetchJson('https://jobicy.com/api/v2/remote-jobs?count=100')) as {
      jobs?: JobicyJob[]
    }
    if (!Array.isArray(data.jobs)) return []
    return data.jobs.map((j) => ({
      externalId: String(j.id),
      title: j.jobTitle,
      company: j.companyName,
      location: j.jobGeo,
      remote: true,
      salary: salary(j),
      description: j.jobDescription ?? j.jobExcerpt ?? '',
      applyUrl: j.url,
      source: 'jobicy',
      postedAt: j.pubDate,
    }))
  },
}
