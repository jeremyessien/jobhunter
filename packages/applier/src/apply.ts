import type { Client } from '@libsql/client'
import type { Config } from '@jobhunter/core'
import { makeThrottledFetch } from '@jobhunter/core'
import { existsSync, mkdirSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { Page } from 'playwright'
import { fetchGreenhouseSchema, parseGreenhouseUrl } from './questions'
import { buildFillPlan, type ApplicantFacts } from './plan'
import { launchSession, findForm, applyFillPlan, highlightNeedsYou, type FoundForm } from './browser'
import { confirmationSeen, decideOutcome, type WaitOutcome } from './confirm'
import { markSubmitted, cooldownBlocked, screenshotPath } from './record'

export type ApplyJob = {
  id: number
  externalKey: string
  title: string
  company: string
  applyUrl: string
  coverLetter: string | null
  answers: { question: string; answer: string }[]
}

export async function approvedJobs(db: Client): Promise<ApplyJob[]> {
  const rs = await db.execute(
    "SELECT id, external_key, title, company, apply_url, cover_letter, answers_json FROM jobs WHERE status='approved' ORDER BY first_seen",
  )
  return rs.rows.map((r) => {
    let answers: { question: string; answer: string }[] = []
    try {
      const parsed = JSON.parse(String(r.answers_json ?? ''))
      if (Array.isArray(parsed)) answers = parsed
    } catch {}
    return {
      id: Number(r.id),
      externalKey: String(r.external_key),
      title: String(r.title),
      company: String(r.company),
      applyUrl: String(r.apply_url),
      coverLetter: r.cover_letter === null ? null : String(r.cover_letter),
      answers,
    }
  })
}

export async function resolveGreenhouse(db: Client, job: ApplyJob): Promise<{ slug: string; id: string } | null> {
  const fromUrl = parseGreenhouseUrl(job.applyUrl)
  if (fromUrl) return fromUrl
  const keyMatch = /^greenhouse:(\d+)$/.exec(job.externalKey)
  if (!keyMatch) return null
  const rs = await db.execute({
    sql: "SELECT slug FROM companies WHERE ats='greenhouse' AND lower(name)=lower(?) LIMIT 1",
    args: [job.company],
  })
  const slug = rs.rows[0]?.slug
  return slug ? { slug: String(slug), id: keyMatch[1] } : null
}

const factsSchema = z.object({
  name: z.string(),
  email: z.string(),
  phone: z.string().optional(),
  location: z.string(),
  links: z.array(z.string()).default([]),
})

async function applicantFacts(db: Client): Promise<ApplicantFacts | null> {
  const rs = await db.execute('SELECT json FROM profile WHERE id=1')
  if (rs.rows.length === 0) return null
  try {
    const parsed = factsSchema.safeParse(JSON.parse(String(rs.rows[0].json)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

async function waitForOutcome(page: Page, rl: ReturnType<typeof createInterface>): Promise<WaitOutcome> {
  const ac = new AbortController()
  let stopWatching = () => {}

  const watcher = new Promise<WaitOutcome>((resolve) => {
    const check = () => {
      try {
        if (confirmationSeen(page.frames().map((f) => f.url()))) resolve('confirmed')
      } catch {
        resolve('skip')
      }
    }
    const onClose = () => resolve('skip')
    page.on('framenavigated', check)
    page.once('close', onClose)
    stopWatching = () => {
      page.off('framenavigated', check)
      page.off('close', onClose)
    }
    check()
  })

  const askLoop = async (): Promise<WaitOutcome> => {
    while (true) {
      const answer = await rl.question(
        '  when done: [s] I submitted it  [k] skip for now  [x] I did not apply — your choice: ',
        { signal: ac.signal },
      )
      const outcome = decideOutcome(answer.trim().toLowerCase())
      if (outcome) return outcome
      console.log('  please answer s, k, or x')
    }
  }

  try {
    return await Promise.race([watcher, askLoop().catch(() => watcher)])
  } finally {
    ac.abort()
    stopWatching()
  }
}

const openPage = async (page: Page, url: string) => {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    return true
  } catch {
    return false
  }
}

export async function runApply(db: Client, config: Config): Promise<void> {
  if (!config.resumePath) {
    console.log('No resume file set. Add "resumePath": "/path/to/resume.pdf" to jobhunter.config.json and rerun.')
    return
  }
  if (!existsSync(config.resumePath)) {
    console.log(`Resume file not found at ${config.resumePath}. Fix the path in jobhunter.config.json and rerun.`)
    return
  }
  const facts = await applicantFacts(db)
  if (!facts) {
    console.log('No profile stored yet. Run: pnpm jobhunter parse-resume <your-resume.pdf>')
    return
  }
  const jobs = await approvedJobs(db)
  if (jobs.length === 0) {
    console.log('Nothing approved yet — approve jobs in Review first.')
    return
  }

  const fetchJson = makeThrottledFetch()
  const nowIso = new Date().toISOString()
  const sessionDir = join('applier-sessions', nowIso.slice(0, 10))
  mkdirSync(sessionDir, { recursive: true })
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const session = await launchSession('applier-profile')
  let submitted = 0
  let skipped = 0

  console.log(`${jobs.length} approved job(s) to apply for\n`)
  try {
    for (const [index, job] of jobs.entries()) {
      console.log(`[${index + 1}/${jobs.length}] ${job.title} · ${job.company}`)
      if (await cooldownBlocked(db, job.company, new Date().toISOString(), config.companyCooldownDays)) {
        console.log(`  skipped: you already applied to ${job.company} in the last ${config.companyCooldownDays} days\n`)
        skipped++
        continue
      }
      const page = await session.context.newPage()
      const gh = await resolveGreenhouse(db, job)
      let found: FoundForm | null = null
      let fillSucceeded = false

      if (gh) {
        const hostedUrl = `https://job-boards.greenhouse.io/${gh.slug}/jobs/${gh.id}`
        const embedUrl = `https://job-boards.greenhouse.io/embed/job_app?for=${gh.slug}&token=${gh.id}`
        if (await openPage(page, hostedUrl)) {
          found = await findForm(page, { timeoutMs: 20000, log: console.log })
        }
        if (!found && (await openPage(page, embedUrl))) {
          found = await findForm(page, { timeoutMs: 20000, log: console.log })
        }
        if (!found && page.url() !== job.applyUrl && (await openPage(page, job.applyUrl))) {
          found = await findForm(page, { timeoutMs: 45000, log: console.log })
        }
        const schema = found ? await fetchGreenhouseSchema(fetchJson, gh.slug, gh.id) : null
        if (found && schema) {
          try {
            const plan = buildFillPlan(schema, { coverLetter: job.coverLetter, answers: job.answers }, facts, config.resumePath)
            const { applied, failed } = await applyFillPlan(found.frame, plan)
            const needsYou = [...plan.needsYou, ...failed]
            await highlightNeedsYou(found.frame, needsYou).catch(() => {
              console.log('  (could not draw the highlights — the list below still applies)')
            })
            console.log(`  filled ${applied} field(s)` + (needsYou.length ? `, ${needsYou.length} need(s) you:` : ''))
            for (const item of needsYou) console.log(`    - ${item.label}: ${item.reason}`)
            await found.frame
              .locator('button[type="submit"], input[type="submit"]')
              .first()
              .scrollIntoViewIfNeeded()
              .catch(() => {})
            console.log('  review the form in the browser, then click Submit yourself')
            fillSucceeded = true
          } catch (err) {
            console.log(`  something went wrong while filling (${err instanceof Error ? err.message.slice(0, 80) : 'unknown'})`)
            console.log('  the page stays open — finish it by hand with your drafts below')
          }
        }
      }

      if (!fillSucceeded) {
        if (!found && !page.url().startsWith('http')) await openPage(page, job.applyUrl)
        if (!found) console.log('  this site is not one I can fill — your drafts, for copy-paste:')
        if (job.coverLetter) console.log(`\n--- cover letter ---\n${job.coverLetter}\n`)
        for (const a of job.answers) console.log(`Q: ${a.question}\nA: ${a.answer}\n`)
      }

      const activePage = found?.page ?? page
      const outcome = await waitForOutcome(activePage, rl)
      if (outcome === 'confirmed' || outcome === 'user-submitted') {
        await markSubmitted(db, job.id, new Date().toISOString())
        await activePage
          .screenshot({ path: screenshotPath(sessionDir, job.id, outcome === 'confirmed' ? 'confirm' : 'manual'), fullPage: true })
          .catch(() => {})
        console.log(`  marked as submitted ✓ (screenshot in ${sessionDir})\n`)
        submitted++
      } else {
        console.log(outcome === 'skip' ? '  left for a later session\n' : '  kept as approved — you did not apply\n')
        skipped++
      }
      if (activePage !== page) await activePage.close().catch(() => {})
      await page.close().catch(() => {})
    }
  } finally {
    rl.close()
    await session.close().catch(() => {})
  }
  console.log(`Done: ${submitted} submitted, ${skipped} left for later.`)
}