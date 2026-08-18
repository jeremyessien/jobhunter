import type { Client } from '@libsql/client'
import { z } from 'zod'
import type { Config, InvokeClaude } from '@jobhunter/core'

export const profileSchema = z.object({
  name: z.string(),
  email: z.string(),
  phone: z.string().optional(),
  location: z.string(),
  links: z.array(z.string()).default([]),
  skills: z.array(z.string()),
  experience: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      start: z.string(),
      end: z.string().nullable(),
      highlights: z.array(z.string()),
    }),
  ),
  education: z.array(z.object({ school: z.string(), credential: z.string() })).default([]),
  voiceSample: z.string().optional(),
  voiceNotes: z.string().optional(),
  screening: z
    .object({
      noticePeriod: z.string().optional(),
      salaryExpectation: z.string().optional(),
      workAuthorization: z.string().optional(),
      salaryExpectationsByLane: z.record(z.string()).optional(),
    })
    .default({}),
})

export type Profile = z.infer<typeof profileSchema>

const PARSE_PROMPT = (pdfPath: string) => `Read the resume PDF at ${pdfPath} using the Read tool.
Extract the candidate's details into JSON with exactly these fields:
name, email, phone (optional), location, links (array of URLs), skills (array of strings),
experience (array of {company, title, start "YYYY-MM", end "YYYY-MM" or null if current, highlights: array of verbatim achievement bullets}),
education (array of {school, credential}), screening ({noticePeriod?, salaryExpectation?, workAuthorization?} - leave keys out if not stated).
Copy achievement bullets faithfully - do not embellish, round numbers, or invent anything.
Reply with ONLY the JSON object.`

const keepCandidateOwned = (existing: Profile, parsed: Profile): Profile => ({
  ...parsed,
  voiceSample: existing.voiceSample ?? parsed.voiceSample,
  voiceNotes: existing.voiceNotes ?? parsed.voiceNotes,
  screening: { ...parsed.screening, ...existing.screening },
})

export async function parseResume(db: Client, pdfPath: string, config: Config, invoke: InvokeClaude): Promise<Profile> {
  const parsed = (await invoke({
    prompt: PARSE_PROMPT(pdfPath),
    model: 'sonnet',
    schema: profileSchema,
    claudeBin: config.claudeBin,
    allowedTools: ['Read'],
  })) as Profile
  // parse-resume is also the repair path, so an unreadable stored profile must not block it
  const existing = await getProfile(db).catch(() => null)
  const profile = existing ? keepCandidateOwned(existing, parsed) : parsed
  await db.execute({
    sql: `INSERT INTO profile(id, json, updated_at) VALUES (1, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at`,
    args: [JSON.stringify(profile)],
  })
  return profile
}

export async function getProfile(db: Client): Promise<Profile | null> {
  const rs = await db.execute('SELECT json FROM profile WHERE id=1')
  if (rs.rows.length === 0) return null
  return profileSchema.parse(JSON.parse(rs.rows[0].json as string))
}
