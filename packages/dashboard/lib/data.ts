import type { Client, Row } from '@libsql/client'

export type QueueItem = {
  id: number
  score: number | null
  title: string
  company: string
  lane: string | null
  applyUrl: string
  verdict: string
  strengths: { claim: string; evidence: string }[]
  gaps: string[]
  draftFlag: string | null
}

export type JobDetail = QueueItem & {
  description: string
  coverLetter: string | null
  answers: { question: string; answer: string }[]
  updatedAt: string | null
  status: string
}

const parseScore = (raw: unknown): Pick<QueueItem, 'verdict' | 'strengths' | 'gaps'> => {
  try {
    const s = JSON.parse(String(raw ?? '')) as {
      verdict?: string
      matched_strengths?: { claim: string; evidence: string }[]
      gaps?: string[]
    }
    return {
      verdict: typeof s.verdict === 'string' ? s.verdict : '',
      strengths: Array.isArray(s.matched_strengths) ? s.matched_strengths : [],
      gaps: Array.isArray(s.gaps) ? s.gaps : [],
    }
  } catch {
    return { verdict: '', strengths: [], gaps: [] }
  }
}

const toQueueItem = (r: Row): QueueItem => ({
  id: Number(r.id),
  score: r.score === null ? null : Number(r.score),
  title: String(r.title),
  company: String(r.company),
  lane: r.lane === null ? null : String(r.lane),
  applyUrl: String(r.apply_url),
  draftFlag: r.draft_flag === null ? null : String(r.draft_flag),
  ...parseScore(r.score_json),
})

export async function queueJobs(db: Client, nowIso: string): Promise<QueueItem[]> {
  const rs = await db.execute({
    sql: `SELECT id, score, title, company, lane, apply_url, draft_flag, score_json FROM jobs
          WHERE status='queued' AND (snoozed_until IS NULL OR snoozed_until <= ?)
          ORDER BY score DESC, first_seen DESC`,
    args: [nowIso],
  })
  return rs.rows.map(toQueueItem)
}

export async function getJob(db: Client, id: number): Promise<JobDetail | null> {
  const rs = await db.execute({
    sql: `SELECT id, score, title, company, lane, apply_url, draft_flag, score_json,
                 description, cover_letter, answers_json, updated_at, status
          FROM jobs WHERE id=?`,
    args: [id],
  })
  const r = rs.rows[0]
  if (!r) return null
  let answers: { question: string; answer: string }[] = []
  try {
    const parsed = JSON.parse(String(r.answers_json ?? ''))
    if (Array.isArray(parsed)) answers = parsed
  } catch {}
  return {
    ...toQueueItem(r),
    description: String(r.description),
    coverLetter: r.cover_letter === null ? null : String(r.cover_letter),
    answers,
    updatedAt: r.updated_at === null ? null : String(r.updated_at),
    status: String(r.status),
  }
}

export async function trackerJobs(db: Client) {
  const rs = await db.execute(
    `SELECT id, title, company, lane, status, submitted_at, responded_at FROM jobs
     WHERE status IN ('submitted','responded','rejected') AND submitted_at IS NOT NULL
     ORDER BY submitted_at DESC`,
  )
  return rs.rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title),
    company: String(r.company),
    lane: r.lane === null ? null : String(r.lane),
    status: String(r.status),
    submittedAt: r.submitted_at === null ? null : String(r.submitted_at),
    respondedAt: r.responded_at === null ? null : String(r.responded_at),
  }))
}

export async function laneStats(db: Client) {
  const rs = await db.execute(
    `SELECT lane, COUNT(*) AS submitted, SUM(CASE WHEN status='responded' THEN 1 ELSE 0 END) AS responded
     FROM jobs WHERE submitted_at IS NOT NULL GROUP BY lane`,
  )
  return rs.rows.map((r) => ({
    lane: String(r.lane ?? 'unknown'),
    submitted: Number(r.submitted),
    responded: Number(r.responded),
  }))
}

export async function sourceHealth(db: Client) {
  const rs = await db.execute(
    'SELECT source, ok, started_at FROM runs ORDER BY source, started_at DESC, id DESC',
  )
  const bySource = new Map<string, { lastRun: string; lastOk: string | null; consecutiveFailures: number; counting: boolean }>()
  for (const r of rs.rows) {
    const source = String(r.source)
    const entry = bySource.get(source) ?? {
      lastRun: String(r.started_at),
      lastOk: null,
      consecutiveFailures: 0,
      counting: true,
    }
    if (r.ok === 1) {
      if (entry.lastOk === null) entry.lastOk = String(r.started_at)
      entry.counting = false
    } else if (entry.counting) {
      entry.consecutiveFailures++
    }
    bySource.set(source, entry)
  }
  return [...bySource.entries()].map(([source, e]) => ({
    source,
    lastRun: e.lastRun,
    lastOk: e.lastOk,
    consecutiveFailures: e.consecutiveFailures,
    warning: e.consecutiveFailures >= 3,
  }))
}
