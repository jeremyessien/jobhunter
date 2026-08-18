import type { Client } from '@libsql/client'
import type { Config } from '@jobhunter/core'

type FilterableJob = {
  title: string
  company: string
  location: string | null
  remote: number
  description: string
}

const anyMatch = (patterns: string[], text: string) =>
  patterns.some((p) => new RegExp(p, 'i').test(text))

export function matchLane(job: FilterableJob, config: Config): string | null {
  if (config.blocklist.some((b) => job.company.toLowerCase().includes(b.toLowerCase()))) return null
  if (anyMatch(config.excludeTitlePatterns, job.title)) return null
  const haystack = `${job.location ?? ''} ${job.description}`
  for (const lane of config.lanes) {
    if (!anyMatch(lane.titlePatterns, job.title)) continue
    // an empty seniorityPatterns list means the lane accepts any level above the exclude list
    if (lane.seniorityPatterns.length > 0 && !anyMatch(lane.seniorityPatterns, job.title)) continue
    switch (lane.rule) {
      case 'remote': {
        const isRemote = job.remote === 1 || /remote/i.test(job.location ?? '')
        if (isRemote && !anyMatch(config.remoteExcludePatterns, haystack)) return lane.id
        break
      }
      case 'visa':
        if (
          anyMatch(config.visaPatterns, job.description) ||
          anyMatch(config.visaFriendlyLocations, job.location ?? '')
        )
          return lane.id
        break
      case 'nigeria':
        if (/nigeria|lagos|abuja/i.test(job.location ?? '')) return lane.id
        break
      case 'any':
        return lane.id
    }
  }
  return null
}

export async function runFilter(db: Client, config: Config) {
  const rs = await db.execute(
    "SELECT id, title, company, location, remote, description FROM jobs WHERE status='sourced'",
  )
  let matched = 0, filteredOut = 0
  for (const row of rs.rows) {
    const lane = matchLane(row as unknown as FilterableJob, config)
    if (lane) {
      await db.execute({ sql: "UPDATE jobs SET status='matched', lane=? WHERE id=?", args: [lane, row.id] })
      matched++
    } else {
      await db.execute({ sql: "UPDATE jobs SET status='filtered_out' WHERE id=?", args: [row.id] })
      filteredOut++
    }
  }
  return { matched, filteredOut }
}
