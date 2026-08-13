import { chromium } from 'playwright'
import { openDb, loadConfig } from '@jobhunter/core'
import { makeThrottledFetch } from '@jobhunter/core'
import { approvedJobs, resolveGreenhouse } from './src/apply'
import { fetchGreenhouseSchema } from './src/questions'
import { buildFillPlan } from './src/plan'
import { findForm, applyFillPlan, highlightNeedsYou } from './src/browser'

const config = loadConfig('../../jobhunter.config.json')
const db = await openDb('file:../../jobhunter.db')
const jobs = await approvedJobs(db)
const job = jobs.find((j) => j.company === 'Coinbase')
if (!job) throw new Error('no approved Coinbase job')
console.log(`JOB: ${job.title} (id ${job.id})`)

const gh = await resolveGreenhouse(db, job)
console.log('RESOLVED:', JSON.stringify(gh))
if (!gh) throw new Error('resolution failed')

const rs = await db.execute('SELECT json FROM profile WHERE id=1')
const profile = JSON.parse(String(rs.rows[0].json))
const facts = { name: profile.name, email: profile.email, phone: profile.phone, location: profile.location, links: profile.links ?? [] }

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage()

const hostedUrl = `https://job-boards.greenhouse.io/${gh.slug}/jobs/${gh.id}`
const embedUrl = `https://job-boards.greenhouse.io/embed/job_app?for=${gh.slug}&token=${gh.id}`
let found = null
await page.goto(hostedUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
found = await findForm(page, { timeoutMs: 20000, log: console.log })
console.log('RUNG 1 (hosted):', found ? 'FORM FOUND' : `no form (landed on ${page.url().slice(0, 60)})`)
if (!found) {
  await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
  found = await findForm(page, { timeoutMs: 20000, log: console.log })
  console.log('RUNG 2 (embed):', found ? 'FORM FOUND' : 'no form')
}
if (!found) throw new Error('form never found')

const schema = await fetchGreenhouseSchema(makeThrottledFetch(), gh.slug, gh.id)
if (!schema || !config.resumePath) throw new Error('schema or resumePath missing')
console.log(`SCHEMA: ${schema.length} questions`)

const plan = buildFillPlan(schema, { coverLetter: job.coverLetter, answers: job.answers }, facts, config.resumePath)
console.log(`PLAN: ${plan.fills.length} fills, ${plan.attachments.length} attachments, ${plan.needsYou.length} needs-you`)

const { applied, failed } = await applyFillPlan(found.frame, plan)
console.log(`APPLIED: ${applied} fields, ${failed.length} runtime failures`)
for (const f of failed) console.log(`  failed: ${f.label} — ${f.reason}`)
for (const n of plan.needsYou) console.log(`  needs-you: ${n.label} — ${n.reason}`)

await highlightNeedsYou(found.frame, [...plan.needsYou, ...failed])
console.log('HIGHLIGHT: no crash, banner count =', await found.frame.locator('#jh-needs-you-banner').count())

const readBack: Record<string, string> = {}
for (const id of ['first_name', 'last_name', 'email', 'phone']) {
  const el = found.frame.locator(`#${id}`)
  if ((await el.count()) > 0) readBack[id] = await el.inputValue().catch(() => '(unreadable)')
}
console.log('READ-BACK:', JSON.stringify(readBack))
const resumeAttached = await found.frame
  .locator('#resume')
  .evaluate((el) => (el as HTMLInputElement).files?.length ?? 0)
  .catch(() => -1)
console.log('RESUME FILES ATTACHED:', resumeAttached)
console.log('URL AFTER EVERYTHING (must not be a confirmation):', found.page.url().slice(0, 90))
await found.page.screenshot({ path: '../../applier-sessions/verify-filled.png', fullPage: true })
console.log('SCREENSHOT: applier-sessions/verify-filled.png')
await browser.close()
