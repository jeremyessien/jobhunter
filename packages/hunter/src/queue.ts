import type { Client } from '@libsql/client'

export async function listQueue(db: Client): Promise<string[]> {
  const rs = await db.execute(
    "SELECT score, title, company, lane, apply_url FROM jobs WHERE status='queued' ORDER BY score DESC, first_seen DESC",
  )
  return rs.rows.map(
    (r) => `[${r.score}/10] ${r.title} — ${r.company} (${r.lane}) ${r.apply_url}`,
  )
}
