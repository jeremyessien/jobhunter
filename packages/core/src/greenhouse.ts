import type { Client } from '@libsql/client'

const APPLY_URL_PATTERN = /greenhouse\.io\/([^/]+)\/jobs\/(\d+)/

export function parseGreenhouseUrl(applyUrl: string): { slug: string; id: string } | null {
  const match = APPLY_URL_PATTERN.exec(applyUrl)
  return match ? { slug: match[1], id: match[2] } : null
}

export async function resolveGreenhouseRef(
  db: Client,
  ref: { applyUrl: string; externalKey: string; company: string },
): Promise<{ slug: string; id: string } | null> {
  const fromUrl = parseGreenhouseUrl(ref.applyUrl)
  if (fromUrl) return fromUrl
  const keyMatch = /^greenhouse:(\d+)$/.exec(ref.externalKey)
  if (!keyMatch) return null
  const rs = await db.execute({
    sql: "SELECT slug FROM companies WHERE ats='greenhouse' AND lower(name)=lower(?) LIMIT 1",
    args: [ref.company],
  })
  const slug = rs.rows[0]?.slug
  return slug ? { slug: String(slug), id: keyMatch[1] } : null
}
