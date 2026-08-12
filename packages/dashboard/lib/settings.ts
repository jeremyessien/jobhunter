import type { Client } from '@libsql/client'
import { configSchema } from '@jobhunter/core'
import { profileSchema, type Profile } from '@jobhunter/hunter'

export async function updateScreening(db: Client, patch: Partial<Profile['screening']>): Promise<Profile> {
  const rs = await db.execute('SELECT json FROM profile WHERE id=1')
  if (rs.rows.length === 0) throw new Error('no profile stored')
  const current = profileSchema.parse(JSON.parse(String(rs.rows[0].json)))
  const updated = profileSchema.parse({
    ...current,
    screening: { ...current.screening, ...patch },
  })
  await db.execute({
    sql: "UPDATE profile SET json=?, updated_at=datetime('now') WHERE id=1",
    args: [JSON.stringify(updated)],
  })
  return updated
}

export function validateConfigText(text: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return 'not valid JSON'
  }
  const result = configSchema.safeParse(parsed)
  if (!result.success) return result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
  return null
}
