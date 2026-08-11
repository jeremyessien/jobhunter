import { readFileSync } from 'node:fs'
import type { Client } from '@libsql/client'

export async function seedCompanies(db: Client, csvPath: string): Promise<number> {
  const lines = readFileSync(csvPath, 'utf8').trim().split('\n')
  const [header, ...rows] = lines
  if (header.trim() !== 'ats,slug,name') throw new Error('seed CSV must have header: ats,slug,name')
  let count = 0
  for (const line of rows) {
    const [ats, slug, name] = line.split(',').map((s) => s.trim())
    if (!ats || !slug) continue
    await db.execute({
      sql: `INSERT INTO companies(ats, slug, name) VALUES (?,?,?)
            ON CONFLICT(ats, slug) DO UPDATE SET name=excluded.name`,
      args: [ats, slug, name ?? null],
    })
    count++
  }
  return count
}
