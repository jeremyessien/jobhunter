import type { Client, Row } from '@libsql/client'

export async function listQueue(db: Client): Promise<string[]> {
  const rs = await db.execute(
    "SELECT score, title, company, lane, apply_url, draft_flag FROM jobs WHERE status='queued' ORDER BY score DESC, first_seen DESC",
  )
  const marker = (flag: unknown) =>
    flag === 'drafted' ? ' [draft ready]' : flag === 'manual' ? ' [write manually]' : ''
  return rs.rows.map(
    (r: Row) => `[${r.score}/10] ${r.title} — ${r.company} (${r.lane}) ${r.apply_url}${marker(r.draft_flag)}`,
  )
}
