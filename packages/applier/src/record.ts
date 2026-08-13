import type { Client } from '@libsql/client'
import { join } from 'node:path'

export async function markSubmitted(db: Client, jobId: number, nowIso: string): Promise<boolean> {
  const rs = await db.execute({
    sql: "UPDATE jobs SET status='submitted', submitted_at=? WHERE id=? AND status='approved'",
    args: [nowIso, jobId],
  })
  return rs.rowsAffected === 1
}

export async function cooldownBlocked(db: Client, company: string, nowIso: string, days: number): Promise<boolean> {
  const rs = await db.execute({
    sql: `SELECT 1 FROM jobs WHERE lower(company)=lower(?) AND submitted_at IS NOT NULL
          AND julianday(?) - julianday(submitted_at) < ? LIMIT 1`,
    args: [company, nowIso, days],
  })
  return rs.rows.length > 0
}

export function screenshotPath(sessionDir: string, jobId: number, kind: 'confirm' | 'manual'): string {
  return join(sessionDir, `${jobId}-${kind}.png`)
}