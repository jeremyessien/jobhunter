import type { RawJob } from '../types'
import type { AdapterCtx, SourceAdapter } from './types'

type RemoteOkJob = {
  id?: string
  position?: string
  company?: string
  description?: string
  location?: string
  date?: string
  apply_url?: string
  url?: string
  salary_min?: number
  salary_max?: number
}

const salary = (j: RemoteOkJob) =>
  j.salary_min && j.salary_max ? `${j.salary_min}-${j.salary_max}` : undefined

export const remoteokAdapter: SourceAdapter = {
  name: 'remoteok',
  async fetchJobs(ctx: AdapterCtx): Promise<RawJob[]> {
    const data = (await ctx.fetchJson('https://remoteok.com/api')) as RemoteOkJob[]
    if (!Array.isArray(data)) return []
    // the feed opens with a legal notice row that carries no position
    return data
      .filter((j) => j.position && j.id)
      .map((j) => ({
        externalId: String(j.id),
        title: String(j.position),
        company: String(j.company ?? 'unknown'),
        location: j.location || undefined,
        remote: true,
        salary: salary(j),
        description: j.description ?? '',
        applyUrl: j.apply_url ?? j.url ?? `https://remoteok.com/remote-jobs/${j.id}`,
        source: 'remoteok',
        postedAt: j.date,
      }))
  },
}
