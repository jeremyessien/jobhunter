import type { RawJob } from '../types'
import type { AdapterCtx, SourceAdapter } from './types'

const decodeEntities = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")

type GhJob = {
  id: number
  title: string
  updated_at?: string
  location?: { name?: string }
  absolute_url: string
  content?: string
}

export const greenhouseAdapter: SourceAdapter = {
  name: 'greenhouse',
  async fetchJobs(ctx: AdapterCtx): Promise<RawJob[]> {
    const rs = await ctx.db.execute("SELECT slug, name FROM companies WHERE ats='greenhouse'")
    const jobs: RawJob[] = []
    for (const row of rs.rows) {
      const slug = row.slug as string
      try {
        const data = (await ctx.fetchJson(
          `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
        )) as { jobs: GhJob[] }
        for (const j of data.jobs) {
          jobs.push({
            externalId: String(j.id),
            title: j.title,
            company: (row.name as string | null) ?? slug,
            location: j.location?.name,
            remote: /remote/i.test(j.location?.name ?? ''),
            description: decodeEntities(j.content ?? ''),
            applyUrl: j.absolute_url,
            source: 'greenhouse',
            atsFamily: 'greenhouse',
            postedAt: j.updated_at,
          })
        }
        await ctx.db.execute({
          sql: "UPDATE companies SET last_seen=datetime('now') WHERE ats='greenhouse' AND slug=?",
          args: [slug],
        })
      } catch (err) {
        console.error(`greenhouse ${slug} failed: ${String(err)}`)
        continue
      }
    }
    return jobs
  },
}
