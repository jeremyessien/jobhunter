import type { Client } from '@libsql/client'
import { z } from 'zod'
import type { Config, InvokeClaude } from '@jobhunter/core'
import type { Profile } from '../profile'

export const scoreSchema = z.object({
  score: z.number().int().min(0).max(10),
  matched_strengths: z.array(z.object({ claim: z.string(), evidence: z.string() })),
  gaps: z.array(z.string()),
  verdict: z.string(),
})

const RUBRIC = `Score how well this candidate fits this job, 1-10:
9-10: meets every stated must-have with direct evidence from the profile; role is squarely in the candidate's core stack and seniority.
7-8: meets all must-haves; at most minor stretch on nice-to-haves.
5-6: meets most must-haves but has one real gap (a required technology, domain, or years-of-experience shortfall).
3-4: multiple must-have gaps.
0-2: wrong role, stack, or seniority entirely.
Rules: every entry in matched_strengths needs "evidence" quoting or closely paraphrasing the profile - no unsupported claims. List concrete gaps honestly. Judge only against what the job text actually requires.`

const judgePrompt = (profile: Profile, title: string, company: string, description: string) =>
  `${RUBRIC}

CANDIDATE PROFILE:
${JSON.stringify(profile)}

JOB: ${title} at ${company}
${description.slice(0, 6000)}

Reply with ONLY a JSON object: {"score": int 1-10, "matched_strengths": [{"claim": string, "evidence": string}], "gaps": [string], "verdict": string (one sentence)}`

export async function runJudge(db: Client, config: Config, profile: Profile, invoke: InvokeClaude, now: string) {
  const candidates = await db.execute({
    sql: `SELECT id, title, company, description FROM jobs WHERE status='matched'
          ORDER BY posted_at IS NULL, posted_at DESC, first_seen DESC LIMIT ?`,
    args: [config.scoreCapPerHunt],
  })
  let scored = 0, queued = 0, failed = 0
  for (const row of candidates.rows) {
    try {
      const result = await invoke({
        prompt: judgePrompt(profile, row.title as string, row.company as string, row.description as string),
        model: 'haiku',
        schema: scoreSchema,
        claudeBin: config.claudeBin,
      })
      scored++
      let status = 'scored'
      if (result.score >= config.queueThreshold) {
        const cooldown = await db.execute({
          sql: `SELECT 1 FROM jobs WHERE lower(company)=lower(?) AND submitted_at IS NOT NULL
                AND julianday(?) - julianday(submitted_at) < ? LIMIT 1`,
          args: [row.company, now, config.companyCooldownDays],
        })
        if (cooldown.rows.length === 0) {
          status = 'queued'
          queued++
        }
      }
      await db.execute({
        sql: 'UPDATE jobs SET status=?, score=?, score_json=? WHERE id=?',
        args: [status, result.score, JSON.stringify(result), row.id],
      })
    } catch (err) {
      failed++
      console.error(`judge failed for ${row.company} - ${row.title}: ${String(err)}`)
      await db.execute({
        sql: "UPDATE jobs SET status='score_failed', score_json=? WHERE id=?",
        args: [JSON.stringify({ error: String(err) }), row.id],
      })
    }
  }
  return { scored, queued, failed }
}
