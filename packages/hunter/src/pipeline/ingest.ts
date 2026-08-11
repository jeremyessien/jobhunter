import type { Client } from '@libsql/client'
import type { RawJob } from '../types.js'

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const dupeKey = (r: { company: string; title: string }) =>
  `${r.company.toLowerCase().trim()}|${r.title.toLowerCase().trim()}`

export async function ingestJobs(db: Client, raws: RawJob[], now: string) {
  let inserted = 0, updated = 0, skipped = 0
  for (const raw of raws) {
    const key = `${raw.source}:${raw.externalId}`
    const desc = stripHtml(raw.description)
    const byKey = await db.execute({ sql: 'SELECT id FROM jobs WHERE external_key = ?', args: [key] })
    if (byKey.rows.length > 0) {
      await db.execute({
        sql: 'UPDATE jobs SET title=?, location=?, remote=?, salary=?, description=?, apply_url=?, updated_at=? WHERE external_key=?',
        args: [raw.title, raw.location ?? null, raw.remote ? 1 : 0, raw.salary ?? null, desc, raw.applyUrl, now, key],
      })
      updated++
      continue
    }
    const dupe = await db.execute({
      sql: 'SELECT id, ats_family FROM jobs WHERE lower(company)=? AND lower(title)=?',
      args: [raw.company.toLowerCase().trim(), raw.title.toLowerCase().trim()],
    })
    if (dupe.rows.length > 0) {
      const existing = dupe.rows[0]
      if (!existing.ats_family && raw.atsFamily) {
        await db.execute({
          sql: 'UPDATE jobs SET external_key=?, source=?, ats_family=?, apply_url=?, description=?, updated_at=? WHERE id=?',
          args: [key, raw.source, raw.atsFamily, raw.applyUrl, desc, now, existing.id],
        })
        updated++
      } else {
        skipped++
      }
      continue
    }
    await db.execute({
      sql: `INSERT INTO jobs(external_key, title, company, location, remote, salary, description, apply_url, source, ats_family, posted_at, first_seen)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [key, raw.title, raw.company, raw.location ?? null, raw.remote ? 1 : 0, raw.salary ?? null, desc, raw.applyUrl, raw.source, raw.atsFamily ?? null, raw.postedAt ?? null, now],
    })
    inserted++
  }
  return { inserted, updated, skipped }
}
