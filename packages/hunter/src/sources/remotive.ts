import type { RawJob } from '../types.js'
import type { AdapterCtx, SourceAdapter } from './types.js'

type RemotiveJob = {
  id: number
  url: string
  title: string
  company_name: string
  candidate_required_location?: string
  salary?: string
  publication_date?: string
  description: string
}

export const remotiveAdapter: SourceAdapter = {
  name: 'remotive',
  async fetchJobs(ctx: AdapterCtx): Promise<RawJob[]> {
    const data = (await ctx.fetchJson(
      'https://remotive.com/api/remote-jobs?category=software-dev',
    )) as { jobs: RemotiveJob[] }
    return data.jobs.map((j) => ({
      externalId: String(j.id),
      title: j.title,
      company: j.company_name,
      location: j.candidate_required_location,
      remote: true,
      salary: j.salary || undefined,
      description: j.description,
      applyUrl: j.url,
      source: 'remotive',
      postedAt: j.publication_date,
    }))
  },
}
