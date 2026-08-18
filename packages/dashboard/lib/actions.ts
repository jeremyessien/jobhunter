import type { Client } from '@libsql/client'
import { styleLint, factLock, getProfile } from '@jobhunter/hunter'
import { queueJobs } from './data'

async function transition(db: Client, id: number, fromStatuses: string[], to: string, extra = '', args: unknown[] = []) {
  const placeholders = fromStatuses.map(() => '?').join(',')
  const rs = await db.execute({
    sql: `UPDATE jobs SET status='${to}'${extra} WHERE id=? AND status IN (${placeholders})`,
    args: [...args, id, ...fromStatuses] as never[],
  })
  return rs.rowsAffected > 0
}

export const approveJob = (db: Client, id: number) => transition(db, id, ['queued'], 'approved')
export const skipJob = (db: Client, id: number) => transition(db, id, ['queued'], 'rejected')
export const markSubmitted = (db: Client, id: number, nowIso: string) =>
  transition(db, id, ['queued', 'approved'], 'submitted', ', submitted_at=?', [nowIso])
export const tagResponded = (db: Client, id: number, nowIso: string) =>
  transition(db, id, ['submitted'], 'responded', ', responded_at=?', [nowIso])
export const tagRejected = (db: Client, id: number) => transition(db, id, ['submitted'], 'rejected')

export async function approveAllReady(db: Client, nowIso: string): Promise<number> {
  const ready = (await queueJobs(db, nowIso)).filter((j) => j.ready)
  let approved = 0
  for (const job of ready) {
    if (await approveJob(db, job.id)) approved++
  }
  return approved
}

export async function snoozeJob(db: Client, id: number, days: number, nowIso: string) {
  const until = new Date(Date.parse(nowIso) + days * 86_400_000).toISOString()
  const rs = await db.execute({
    sql: "UPDATE jobs SET snoozed_until=? WHERE id=? AND status='queued'",
    args: [until, id],
  })
  return rs.rowsAffected > 0
}

export async function saveDraft(
  db: Client,
  id: number,
  coverLetter: string,
  answers: { question: string; answer: string }[],
): Promise<string[]> {
  const rs = await db.execute({ sql: 'SELECT title, company, description FROM jobs WHERE id=?', args: [id] })
  const job = rs.rows[0]
  if (!job) return ['job not found']
  await db.execute({
    sql: "UPDATE jobs SET cover_letter=?, answers_json=?, draft_flag='drafted' WHERE id=?",
    args: [coverLetter, JSON.stringify(answers), id],
  })
  const profile = await getProfile(db)
  const fullText = [coverLetter, ...answers.map((a) => a.answer)].join('\n')
  const sources = [
    profile ? JSON.stringify(profile) : '',
    String(job.description),
    String(job.title),
    String(job.company),
  ]
  return [...styleLint(fullText), ...factLock(fullText, sources)]
}
