# Jobhunter Dashboard Implementation Plan (Plan 3 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phone-friendly local dashboard (`pnpm dashboard`) where Jeremiah reads the queue with scores/evidence/drafts, edits drafts inline with gate warnings, Approves/Skips/Snoozes jobs, tracks submitted applications per lane, watches source health, and edits his screening facts — including the per-lane salary policy, which this plan also wires into the drafter.

**Architecture:** New `packages/dashboard` Next.js App Router app, 100% server components + server actions (zero client JS). All logic lives in plain testable functions (`lib/data.ts`, `lib/actions.ts`, `lib/settings.ts`) that take a libSQL `Client` — pages are thin wrappers. One new DB migration (`snoozed_until`). The salary policy lands first in `@jobhunter/hunter` (profile schema + drafter prompt) so drafts benefit immediately.

**Tech Stack:** Next.js ^16, React ^19, TypeScript strict, vitest for all lib logic (temp SQLite DBs, no browser tests), existing `@jobhunter/core` + `@jobhunter/hunter`.

**Deployment note (deliberate):** This plan is local-first — no auth, no Vercel. The spec's Google-login Vercel deployment requires the cloud DB and lands in Plan 5 with Turso; everything here runs against the local `jobhunter.db` and deploys unchanged later.

**Carry-forwards honored here:** answers_json question text renders only through React JSX text nodes (auto-escaped — never `dangerouslySetInnerHTML`); `updated_at` shown beside drafts as a staleness signal; salary values are Jeremiah's decision, entered in Settings, never invented (fact-lock already enforces this mechanically).

## Global Constraints

- Salary three-tier rule (exact): (1) job text states a range → anchor to it; (2) else lane-configured expectation from `profile.screening.salaryExpectationsByLane` → state it verbatim; (3) else honest deflection. The tool NEVER invents a figure.
- Statuses (exact strings, from Plan 1): `queued → approved` (Approve), `queued → rejected` (Skip), `queued → submitted` (manual mark, sets `submitted_at`), `submitted → responded|rejected` (Tracker tagging). Snooze keeps status `queued`, sets `snoozed_until`; queue hides rows with `snoozed_until > now`.
- Draft edits are human-authored: saving always stores and sets `draft_flag='drafted'`; styleLint/factLock run on save as NON-blocking warnings (human overrides the gates).
- All dashboard logic testable without Next: lib functions take `(db, ...)`, pages only compose.
- No `'use client'` anywhere; forms post to server actions.
- Workflow: feature branch, PR into `dev`, no direct pushes to main/dev. No `Co-Authored-By`/AI attribution anywhere. Plain imperative commits, one concern each.
- No code comments unless genuinely non-obvious. Existing 80 tests stay green.

---

### Task 1: Per-lane salary policy in profile + drafter

**Files:**
- Modify: `packages/hunter/src/profile.ts` (screening gains `salaryExpectationsByLane`)
- Modify: `packages/hunter/src/pipeline/drafter.ts` (salary policy block in prompt; select `lane`)
- Test: `packages/hunter/test/profile.test.ts` (extend), `packages/hunter/test/drafter.test.ts` (extend)

**Interfaces:**
- Consumes: existing `profileSchema`, `draftPrompt` internals.
- Produces: `Profile['screening']` gains optional `salaryExpectationsByLane?: Record<string, string>` (lane id → expectation string, e.g. `"$90k-$110k"`). Drafter prompt gains a `SALARY POLICY` block implementing the three-tier rule. `DraftableJob` gains `lane: string | null`.

- [ ] **Step 1: Extend the failing tests**

In `packages/hunter/test/profile.test.ts` add:

```ts
  it('accepts per-lane salary expectations in screening', async () => {
    const db = await tmpDb()
    const withSalary = {
      ...canned,
      screening: { salaryExpectationsByLane: { 'remote-mobile': '$90k-$110k' } },
    }
    const invoke = (() => Promise.resolve(withSalary)) as unknown as InvokeClaude
    await parseResume(db, '/fake/resume.pdf', config, invoke)
    const profile = await getProfile(db)
    expect(profile?.screening.salaryExpectationsByLane).toEqual({ 'remote-mobile': '$90k-$110k' })
  })
```

In `packages/hunter/test/drafter.test.ts` add two tests (reuse existing helpers; `seedQueued` already sets `lane: 'x'`):

```ts
  it('states the lane-configured salary expectation in the prompt', async () => {
    const db = await tmpDb()
    await seedQueued(db, 'a:1', 8)
    const salaryProfile: Profile = {
      ...profile,
      screening: { ...profile.screening, salaryExpectationsByLane: { x: '$90k-$110k' } },
    }
    const { invoke, prompts } = invokeReturning([cleanDraft])
    await runDrafter({ db, config, profile: salaryProfile, invoke, fetchJson: async () => ({}) })
    expect(prompts[0]).toContain('SALARY POLICY')
    expect(prompts[0]).toContain('$90k-$110k')
  })

  it('falls back to the flexible-deflection salary line when no lane expectation exists', async () => {
    const db = await tmpDb()
    await seedQueued(db, 'a:1', 8)
    const { invoke, prompts } = invokeReturning([cleanDraft])
    await runDrafter({ db, config, profile, invoke, fetchJson: async () => ({}) })
    expect(prompts[0]).toContain('flexible depending on the total package')
    expect(prompts[0]).not.toContain('$90k')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `salaryExpectationsByLane` rejected by schema; prompts lack SALARY POLICY

- [ ] **Step 3: Implement**

In `packages/hunter/src/profile.ts`, inside the `screening` object add:

```ts
      salaryExpectationsByLane: z.record(z.string()).optional(),
```

(no `.default()` — absent stays absent so existing round-trip tests hold.)

In `packages/hunter/src/pipeline/drafter.ts`:

Add `lane` to the SELECT column list and to `DraftableJob`:

```ts
type DraftableJob = {
  id: unknown
  title: string
  company: string
  description: string
  apply_url: string
  source: string
  lane: string | null
}
```

(SELECT becomes `SELECT id, title, company, description, apply_url, source, lane FROM jobs ...`.)

Add above `draftPrompt`:

```ts
const salaryPolicy = (profile: Profile, lane: string | null) => {
  const expectation = lane ? profile.screening.salaryExpectationsByLane?.[lane] : undefined
  const fallback = expectation
    ? `state the candidate's expectation verbatim: "${expectation}"`
    : 'say the candidate is flexible depending on the total package and would rather discuss numbers than guess one'
  return `SALARY POLICY (for any question about salary or compensation):
1. If the JOB text states a salary or range, anchor to it and say it works for the candidate.
2. Otherwise ${fallback}.
3. Never state a figure that appears in neither the profile nor the JOB text.`
}
```

In `draftPrompt`, insert `${salaryPolicy(profile, job.lane)}` on its own paragraph directly after the SCREENING QUESTIONS block (before the `Reply with ONLY` line).

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test`
Expected: PASS (83 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/hunter
git commit -m "Add per-lane salary policy to profile and drafter prompt"
```

---

### Task 2: Dashboard scaffold, snoozed_until migration, data layer

**Files:**
- Modify: `packages/core/src/db.ts` (append migration), `.gitignore` (add `.next/`), root `package.json` (add `dashboard` script)
- Create: `packages/dashboard/package.json`, `packages/dashboard/tsconfig.json`, `packages/dashboard/next-env.d.ts`, `packages/dashboard/next.config.mjs`, `packages/dashboard/lib/db.ts`, `packages/dashboard/lib/data.ts`
- Test: `packages/core/test/db.test.ts` (extend), `packages/dashboard/test/data.test.ts`

**Interfaces:**
- Consumes: `openDb`, `loadConfig`, `Config` from `@jobhunter/core`; jobs/runs tables.
- Produces (later tasks and pages rely on these exact signatures):
  - Migration 5: `ALTER TABLE jobs ADD COLUMN snoozed_until TEXT`
  - `getDb(): Promise<Client>` (memoized), `getConfig(): Config`, `configPath: string`, `repoRoot: string` from `lib/db.ts`
  - From `lib/data.ts`:
    - `QueueItem = { id: number; score: number | null; title: string; company: string; lane: string | null; applyUrl: string; verdict: string; strengths: { claim: string; evidence: string }[]; gaps: string[]; draftFlag: string | null }`
    - `queueJobs(db: Client, nowIso: string): Promise<QueueItem[]>` — status queued, not snoozed, score DESC
    - `JobDetail = QueueItem & { description: string; coverLetter: string | null; answers: { question: string; answer: string }[]; updatedAt: string | null; status: string }`
    - `getJob(db: Client, id: number): Promise<JobDetail | null>`
    - `trackerJobs(db: Client): Promise<{ id: number; title: string; company: string; lane: string | null; status: string; submittedAt: string | null; respondedAt: string | null }[]>` — status in submitted/responded/rejected with submitted_at set, newest submitted first
    - `laneStats(db: Client): Promise<{ lane: string; submitted: number; responded: number }[]>`
    - `sourceHealth(db: Client): Promise<{ source: string; lastRun: string; lastOk: string | null; consecutiveFailures: number; warning: boolean }[]>` — warning at ≥3 consecutive failures

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/test/db.test.ts`:

```ts
  it('has the snoozed_until column on jobs', async () => {
    const db = await openDb(tmpUrl())
    const rs = await db.execute("SELECT name FROM pragma_table_info('jobs') WHERE name='snoozed_until'")
    expect(rs.rows).toHaveLength(1)
  })
```

`packages/dashboard/test/data.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '@jobhunter/core'
import { queueJobs, getJob, trackerJobs, laneStats, sourceHealth } from '../lib/data.js'

const NOW = '2026-08-12T09:00:00Z'
const tmpDb = () => openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))

const scoreJson = JSON.stringify({
  score: 8,
  matched_strengths: [{ claim: 'Flutter depth', evidence: 'Cold start 11.4s to 2.1s' }],
  gaps: ['No Rust'],
  verdict: 'strong fit',
})

async function seed(db: Awaited<ReturnType<typeof tmpDb>>, over: Record<string, unknown> = {}) {
  const cols = {
    external_key: 'k:' + Math.random().toString(36).slice(2),
    title: 'Senior Flutter Engineer',
    company: 'Acme',
    description: 'Build apps',
    apply_url: 'https://x/apply',
    source: 's',
    first_seen: NOW,
    status: 'queued',
    score: 8,
    lane: 'remote-mobile',
    score_json: scoreJson,
    ...over,
  }
  const keys = Object.keys(cols)
  await db.execute({
    sql: `INSERT INTO jobs(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
    args: Object.values(cols) as never[],
  })
  const rs = await db.execute('SELECT last_insert_rowid() AS id')
  return Number(rs.rows[0].id)
}

describe('queueJobs', () => {
  it('lists queued jobs with parsed evidence, highest score first', async () => {
    const db = await tmpDb()
    await seed(db, { score: 7 })
    await seed(db, { score: 9, title: 'Senior Mobile Engineer' })
    await seed(db, { status: 'scored' })
    const q = await queueJobs(db, NOW)
    expect(q.map((j) => j.score)).toEqual([9, 7])
    expect(q[0].strengths[0].evidence).toContain('11.4s')
    expect(q[0].gaps).toEqual(['No Rust'])
    expect(q[0].verdict).toBe('strong fit')
  })

  it('hides snoozed jobs until the snooze expires', async () => {
    const db = await tmpDb()
    await seed(db, { snoozed_until: '2026-08-13T00:00:00Z' })
    await seed(db, { snoozed_until: '2026-08-11T00:00:00Z', title: 'Woken Job' })
    const q = await queueJobs(db, NOW)
    expect(q).toHaveLength(1)
    expect(q[0].title).toBe('Woken Job')
  })

  it('survives malformed score_json', async () => {
    const db = await tmpDb()
    await seed(db, { score_json: '{"error":"quota"}' })
    const q = await queueJobs(db, NOW)
    expect(q[0].verdict).toBe('')
    expect(q[0].strengths).toEqual([])
  })
})

describe('getJob', () => {
  it('returns full detail with parsed answers', async () => {
    const db = await tmpDb()
    const id = await seed(db, {
      cover_letter: 'A letter.',
      answers_json: JSON.stringify([{ question: 'Why?', answer: 'Because.' }]),
      draft_flag: 'drafted',
      updated_at: NOW,
    })
    const j = await getJob(db, id)
    expect(j?.coverLetter).toBe('A letter.')
    expect(j?.answers).toEqual([{ question: 'Why?', answer: 'Because.' }])
    expect(j?.updatedAt).toBe(NOW)
    expect(j?.status).toBe('queued')
  })

  it('returns null for a missing id', async () => {
    const db = await tmpDb()
    expect(await getJob(db, 999)).toBeNull()
  })
})

describe('trackerJobs + laneStats', () => {
  it('lists submitted-and-beyond jobs and computes per-lane stats', async () => {
    const db = await tmpDb()
    await seed(db, { status: 'submitted', submitted_at: '2026-08-10T00:00:00Z' })
    await seed(db, { status: 'responded', submitted_at: '2026-08-09T00:00:00Z', responded_at: NOW })
    await seed(db, { status: 'rejected', submitted_at: '2026-08-08T00:00:00Z', lane: 'nigeria-local' })
    await seed(db) // queued — excluded
    const t = await trackerJobs(db)
    expect(t.map((j) => j.status)).toEqual(['submitted', 'responded', 'rejected'])
    const stats = await laneStats(db)
    expect(stats).toContainEqual({ lane: 'remote-mobile', submitted: 2, responded: 1 })
    expect(stats).toContainEqual({ lane: 'nigeria-local', submitted: 1, responded: 0 })
  })
})

describe('sourceHealth', () => {
  it('computes consecutive failures and warns at three', async () => {
    const db = await tmpDb()
    const run = (source: string, ok: number, at: string) =>
      db.execute({
        sql: 'INSERT INTO runs(started_at, finished_at, source, ok, jobs_found) VALUES (?,?,?,?,0)',
        args: [at, at, source, ok],
      })
    await run('greenhouse', 1, '2026-08-10T00:00:00Z')
    await run('greenhouse', 0, '2026-08-11T00:00:00Z')
    await run('greenhouse', 0, '2026-08-11T12:00:00Z')
    await run('greenhouse', 0, '2026-08-12T00:00:00Z')
    await run('remotive', 0, '2026-08-11T00:00:00Z')
    await run('remotive', 1, '2026-08-12T00:00:00Z')
    const h = await sourceHealth(db)
    const gh = h.find((s) => s.source === 'greenhouse')
    const rm = h.find((s) => s.source === 'remotive')
    expect(gh).toMatchObject({ consecutiveFailures: 3, warning: true, lastOk: '2026-08-10T00:00:00Z' })
    expect(rm).toMatchObject({ consecutiveFailures: 0, warning: false })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — snoozed_until column missing; cannot resolve `../lib/data.js`

- [ ] **Step 3: Implement**

In `packages/core/src/db.ts` append to `MIGRATIONS`:

```ts
  `ALTER TABLE jobs ADD COLUMN snoozed_until TEXT`,
```

Add `.next/` on its own line to the root `.gitignore`. Add to root `package.json` scripts:

```json
    "dashboard": "pnpm --filter @jobhunter/dashboard dev"
```

`packages/dashboard/package.json`:

```json
{
  "name": "@jobhunter/dashboard",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev -p 3777",
    "build": "next build",
    "start": "next start -p 3777"
  },
  "dependencies": {
    "@jobhunter/core": "workspace:*",
    "@jobhunter/hunter": "workspace:*",
    "next": "^16.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.6.0"
  }
}
```

`packages/dashboard/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`packages/dashboard/next-env.d.ts`:

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
```

`packages/dashboard/next.config.mjs`:

```js
export default {}
```

`packages/dashboard/lib/db.ts`:

```ts
import { join, resolve } from 'node:path'
import type { Client } from '@libsql/client'
import { loadConfig, openDb, type Config } from '@jobhunter/core'

export const repoRoot = process.env.JOBHUNTER_ROOT ?? resolve(process.cwd(), '..', '..')
export const configPath = join(repoRoot, 'jobhunter.config.json')

export function getConfig(): Config {
  return loadConfig(configPath)
}

let client: Promise<Client> | null = null

export function getDb(): Promise<Client> {
  if (!client) {
    const config = getConfig()
    const url = config.dbUrl.startsWith('file:')
      ? 'file:' + resolve(repoRoot, config.dbUrl.slice(5))
      : config.dbUrl
    client = openDb(url, config.dbAuthToken)
  }
  return client
}
```

`packages/dashboard/lib/data.ts`:

```ts
import type { Client, Row } from '@libsql/client'

export type QueueItem = {
  id: number
  score: number | null
  title: string
  company: string
  lane: string | null
  applyUrl: string
  verdict: string
  strengths: { claim: string; evidence: string }[]
  gaps: string[]
  draftFlag: string | null
}

export type JobDetail = QueueItem & {
  description: string
  coverLetter: string | null
  answers: { question: string; answer: string }[]
  updatedAt: string | null
  status: string
}

const parseScore = (raw: unknown): Pick<QueueItem, 'verdict' | 'strengths' | 'gaps'> => {
  try {
    const s = JSON.parse(String(raw ?? '')) as {
      verdict?: string
      matched_strengths?: { claim: string; evidence: string }[]
      gaps?: string[]
    }
    return {
      verdict: typeof s.verdict === 'string' ? s.verdict : '',
      strengths: Array.isArray(s.matched_strengths) ? s.matched_strengths : [],
      gaps: Array.isArray(s.gaps) ? s.gaps : [],
    }
  } catch {
    return { verdict: '', strengths: [], gaps: [] }
  }
}

const toQueueItem = (r: Row): QueueItem => ({
  id: Number(r.id),
  score: r.score === null ? null : Number(r.score),
  title: String(r.title),
  company: String(r.company),
  lane: r.lane === null ? null : String(r.lane),
  applyUrl: String(r.apply_url),
  draftFlag: r.draft_flag === null ? null : String(r.draft_flag),
  ...parseScore(r.score_json),
})

export async function queueJobs(db: Client, nowIso: string): Promise<QueueItem[]> {
  const rs = await db.execute({
    sql: `SELECT id, score, title, company, lane, apply_url, draft_flag, score_json FROM jobs
          WHERE status='queued' AND (snoozed_until IS NULL OR snoozed_until <= ?)
          ORDER BY score DESC, first_seen DESC`,
    args: [nowIso],
  })
  return rs.rows.map(toQueueItem)
}

export async function getJob(db: Client, id: number): Promise<JobDetail | null> {
  const rs = await db.execute({
    sql: `SELECT id, score, title, company, lane, apply_url, draft_flag, score_json,
                 description, cover_letter, answers_json, updated_at, status
          FROM jobs WHERE id=?`,
    args: [id],
  })
  const r = rs.rows[0]
  if (!r) return null
  let answers: { question: string; answer: string }[] = []
  try {
    const parsed = JSON.parse(String(r.answers_json ?? ''))
    if (Array.isArray(parsed)) answers = parsed
  } catch {}
  return {
    ...toQueueItem(r),
    description: String(r.description),
    coverLetter: r.cover_letter === null ? null : String(r.cover_letter),
    answers,
    updatedAt: r.updated_at === null ? null : String(r.updated_at),
    status: String(r.status),
  }
}

export async function trackerJobs(db: Client) {
  const rs = await db.execute(
    `SELECT id, title, company, lane, status, submitted_at, responded_at FROM jobs
     WHERE status IN ('submitted','responded','rejected') AND submitted_at IS NOT NULL
     ORDER BY submitted_at DESC`,
  )
  return rs.rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title),
    company: String(r.company),
    lane: r.lane === null ? null : String(r.lane),
    status: String(r.status),
    submittedAt: r.submitted_at === null ? null : String(r.submitted_at),
    respondedAt: r.responded_at === null ? null : String(r.responded_at),
  }))
}

export async function laneStats(db: Client) {
  const rs = await db.execute(
    `SELECT lane, COUNT(*) AS submitted, SUM(CASE WHEN status='responded' THEN 1 ELSE 0 END) AS responded
     FROM jobs WHERE submitted_at IS NOT NULL GROUP BY lane`,
  )
  return rs.rows.map((r) => ({
    lane: String(r.lane ?? 'unknown'),
    submitted: Number(r.submitted),
    responded: Number(r.responded ?? 0),
  }))
}

export async function sourceHealth(db: Client) {
  const rs = await db.execute(
    'SELECT source, ok, started_at FROM runs ORDER BY source, started_at DESC, id DESC',
  )
  const bySource = new Map<string, { lastRun: string; lastOk: string | null; consecutiveFailures: number; counting: boolean }>()
  for (const r of rs.rows) {
    const source = String(r.source)
    const entry = bySource.get(source) ?? {
      lastRun: String(r.started_at),
      lastOk: null,
      consecutiveFailures: 0,
      counting: true,
    }
    if (r.ok === 1 || r.ok === 1n) {
      if (entry.lastOk === null) entry.lastOk = String(r.started_at)
      entry.counting = false
    } else if (entry.counting) {
      entry.consecutiveFailures++
    }
    bySource.set(source, entry)
  }
  return [...bySource.entries()].map(([source, e]) => ({
    source,
    lastRun: e.lastRun,
    lastOk: e.lastOk,
    consecutiveFailures: e.consecutiveFailures,
    warning: e.consecutiveFailures >= 3,
  }))
}
```

Run `pnpm install` after creating the package.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test`
Expected: PASS (all suites incl. new data tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core packages/dashboard .gitignore package.json pnpm-lock.yaml
git commit -m "Scaffold dashboard package with snooze migration and data layer"
```

---

### Task 3: Status and draft actions library

**Files:**
- Create: `packages/dashboard/lib/actions.ts`
- Test: `packages/dashboard/test/actions.test.ts`

**Interfaces:**
- Consumes: jobs table; `styleLint`, `factLock`, `getProfile` from `@jobhunter/hunter`.
- Produces (Task 4/5 pages call exactly these):
  - `approveJob(db, id): Promise<boolean>` — `queued → approved`; false if job wasn't queued
  - `skipJob(db, id): Promise<boolean>` — `queued → rejected`
  - `snoozeJob(db, id, days: number, nowIso: string): Promise<boolean>` — stays `queued`, sets `snoozed_until = now + days`
  - `markSubmitted(db, id, nowIso): Promise<boolean>` — `queued|approved → submitted`, sets `submitted_at`
  - `tagResponded(db, id, nowIso): Promise<boolean>` — `submitted → responded`, sets `responded_at`
  - `tagRejected(db, id): Promise<boolean>` — `submitted → rejected`
  - `saveDraft(db, id, coverLetter: string, answers: {question,answer}[]): Promise<string[]>` — stores draft, sets `draft_flag='drafted'`, returns NON-blocking gate warnings (styleLint + factLock vs profile+job)

- [ ] **Step 1: Write the failing test**

`packages/dashboard/test/actions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '@jobhunter/core'
import { approveJob, skipJob, snoozeJob, markSubmitted, tagResponded, tagRejected, saveDraft } from '../lib/actions.js'

const NOW = '2026-08-12T09:00:00Z'
const tmpDb = () => openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))

async function seed(db: Awaited<ReturnType<typeof tmpDb>>, status = 'queued') {
  await db.execute({
    sql: `INSERT INTO jobs(external_key, title, company, description, apply_url, source, first_seen, status, lane)
          VALUES ('k:' || abs(random()), 'Senior Flutter Engineer','Acme','Build apps with 11.4s to 2.1s budgets','u','s',?,?,'x')`,
    args: [NOW, status],
  })
  const rs = await db.execute('SELECT last_insert_rowid() AS id')
  return Number(rs.rows[0].id)
}

const status = async (db: Awaited<ReturnType<typeof tmpDb>>, id: number) =>
  String((await db.execute({ sql: 'SELECT status FROM jobs WHERE id=?', args: [id] })).rows[0].status)

describe('status transitions', () => {
  it('approves only queued jobs', async () => {
    const db = await tmpDb()
    const id = await seed(db)
    expect(await approveJob(db, id)).toBe(true)
    expect(await status(db, id)).toBe('approved')
    expect(await approveJob(db, id)).toBe(false)
  })

  it('skips a queued job to rejected', async () => {
    const db = await tmpDb()
    const id = await seed(db)
    expect(await skipJob(db, id)).toBe(true)
    expect(await status(db, id)).toBe('rejected')
  })

  it('snoozes by setting snoozed_until without changing status', async () => {
    const db = await tmpDb()
    const id = await seed(db)
    expect(await snoozeJob(db, id, 3, NOW)).toBe(true)
    const rs = await db.execute({ sql: 'SELECT status, snoozed_until FROM jobs WHERE id=?', args: [id] })
    expect(rs.rows[0].status).toBe('queued')
    expect(rs.rows[0].snoozed_until).toBe('2026-08-15T09:00:00.000Z')
  })

  it('marks approved jobs submitted with a timestamp', async () => {
    const db = await tmpDb()
    const id = await seed(db, 'approved')
    expect(await markSubmitted(db, id, NOW)).toBe(true)
    const rs = await db.execute({ sql: 'SELECT status, submitted_at FROM jobs WHERE id=?', args: [id] })
    expect(rs.rows[0].status).toBe('submitted')
    expect(rs.rows[0].submitted_at).toBe(NOW)
  })

  it('tags submitted jobs responded or rejected', async () => {
    const db = await tmpDb()
    const a = await seed(db, 'submitted')
    expect(await tagResponded(db, a, NOW)).toBe(true)
    expect(await status(db, a)).toBe('responded')
    const b = await seed(db, 'submitted')
    expect(await tagRejected(db, b)).toBe(true)
    expect(await status(db, b)).toBe('rejected')
  })
})

describe('saveDraft', () => {
  it('stores the edit, sets draft_flag, and returns no warnings for clean text', async () => {
    const db = await tmpDb()
    const id = await seed(db)
    const warnings = await saveDraft(db, id, 'I ship reliable apps.', [{ question: 'Why?', answer: 'Because I do.' }])
    expect(warnings).toEqual([])
    const rs = await db.execute({ sql: 'SELECT cover_letter, answers_json, draft_flag FROM jobs WHERE id=?', args: [id] })
    expect(rs.rows[0].cover_letter).toBe('I ship reliable apps.')
    expect(JSON.parse(String(rs.rows[0].answers_json))).toEqual([{ question: 'Why?', answer: 'Because I do.' }])
    expect(rs.rows[0].draft_flag).toBe('drafted')
  })

  it('stores anyway but returns gate warnings for violating text', async () => {
    const db = await tmpDb()
    const id = await seed(db)
    const warnings = await saveDraft(db, id, 'I am thrilled — I boosted revenue 82%.', [])
    expect(warnings.some((w) => w.includes('em-dash'))).toBe(true)
    expect(warnings.some((w) => w.includes('82'))).toBe(true)
    const rs = await db.execute({ sql: 'SELECT cover_letter FROM jobs WHERE id=?', args: [id] })
    expect(String(rs.rows[0].cover_letter)).toContain('82%')
  })

  it('lets numbers from the job description pass fact-lock', async () => {
    const db = await tmpDb()
    const id = await seed(db)
    const warnings = await saveDraft(db, id, 'Your 11.4s to 2.1s budget matches my experience.', [])
    expect(warnings).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — cannot resolve `../lib/actions.js`

- [ ] **Step 3: Implement**

`packages/dashboard/lib/actions.ts`:

```ts
import type { Client } from '@libsql/client'
import { styleLint, factLock, getProfile } from '@jobhunter/hunter'

async function transition(db: Client, id: number, fromStatuses: string[], to: string, extra = '', args: unknown[] = []) {
  const placeholders = fromStatuses.map(() => '?').join(',')
  const rs = await db.execute({
    sql: `UPDATE jobs SET status='${to}'${extra} WHERE id=? AND status IN (${placeholders})`,
    args: [...args, id, ...fromStatuses] as never[],
  })
  return rs.rowsAffected > 0
}

export const approveJob = (db: Client, id: number) => transition(db, id, ['queued'], 'approved')
export const skipJob = (db: Client, id: number) => transition(db, id, ['queued'], 'rejected')
export const markSubmitted = (db: Client, id: number, nowIso: string) =>
  transition(db, id, ['queued', 'approved'], 'submitted', ', submitted_at=?', [nowIso])
export const tagResponded = (db: Client, id: number, nowIso: string) =>
  transition(db, id, ['submitted'], 'responded', ', responded_at=?', [nowIso])
export const tagRejected = (db: Client, id: number) => transition(db, id, ['submitted'], 'rejected')

export async function snoozeJob(db: Client, id: number, days: number, nowIso: string) {
  const until = new Date(Date.parse(nowIso) + days * 86_400_000).toISOString()
  const rs = await db.execute({
    sql: "UPDATE jobs SET snoozed_until=? WHERE id=? AND status='queued'",
    args: [until, id],
  })
  return rs.rowsAffected > 0
}

export async function saveDraft(
  db: Client,
  id: number,
  coverLetter: string,
  answers: { question: string; answer: string }[],
): Promise<string[]> {
  const rs = await db.execute({ sql: 'SELECT title, company, description FROM jobs WHERE id=?', args: [id] })
  const job = rs.rows[0]
  if (!job) return ['job not found']
  await db.execute({
    sql: "UPDATE jobs SET cover_letter=?, answers_json=?, draft_flag='drafted' WHERE id=?",
    args: [coverLetter, JSON.stringify(answers), id],
  })
  const profile = await getProfile(db)
  const fullText = [coverLetter, ...answers.map((a) => a.answer)].join('\n')
  const sources = [
    profile ? JSON.stringify(profile) : '',
    String(job.description),
    String(job.title),
    String(job.company),
  ]
  return [...styleLint(fullText), ...factLock(fullText, sources)]
}
```

Note: `transition` interpolates `to` and `extra` into SQL — both come only from the exported wrappers' literal arguments, never from caller runtime input; ids and timestamps stay parameterized. Do not accept caller-supplied status strings.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard
git commit -m "Add dashboard status and draft actions"
```

---

### Task 4: Queue and Detail pages

**Files:**
- Create: `packages/dashboard/app/layout.tsx`, `packages/dashboard/app/globals.css`, `packages/dashboard/app/page.tsx`, `packages/dashboard/app/job/[id]/page.tsx`, `packages/dashboard/app/job/[id]/actions.ts`
- Test: none new (pages are thin composition over Tasks 2-3 libs; `next build` is the compile gate; visual smoke in Task 6).

**Interfaces:**
- Consumes: `getDb` (T2), `queueJobs`/`getJob` (T2), T3 actions.
- Produces: routes `/` (queue) and `/job/[id]` (detail). Server actions in `app/job/[id]/actions.ts`: `approve`, `skip`, `snooze`, `submit`, `save` — all take `FormData`, revalidate and redirect.

- [ ] **Step 1: Implement the shell**

`packages/dashboard/app/globals.css`:

```css
* { box-sizing: border-box; }
body { font: 16px/1.5 -apple-system, system-ui, sans-serif; margin: 0; background: #f5f5f4; color: #1c1917; }
nav { display: flex; gap: 1rem; padding: .75rem 1rem; background: #1c1917; }
nav a { color: #fafaf9; text-decoration: none; font-weight: 600; }
main { max-width: 720px; margin: 0 auto; padding: 1rem; }
.card { background: #fff; border-radius: 8px; padding: 1rem; margin-bottom: .75rem; box-shadow: 0 1px 2px rgb(0 0 0 / .08); }
.card h2 { margin: 0 0 .25rem; font-size: 1.05rem; }
.meta { color: #57534e; font-size: .85rem; }
.badge { display: inline-block; padding: .1rem .5rem; border-radius: 999px; font-size: .75rem; background: #e7e5e4; margin-left: .5rem; }
.badge.ready { background: #dcfce7; }
.badge.manual { background: #fef9c3; }
.badge.warn { background: #fee2e2; }
ul { padding-left: 1.2rem; margin: .5rem 0; }
textarea { width: 100%; min-height: 8rem; font: inherit; padding: .5rem; border: 1px solid #d6d3d1; border-radius: 6px; }
button, select { font: inherit; padding: .4rem .9rem; border-radius: 6px; border: 1px solid #d6d3d1; background: #fff; cursor: pointer; }
button.primary { background: #1c1917; color: #fff; border-color: #1c1917; }
.actions { display: flex; gap: .5rem; flex-wrap: wrap; margin: 1rem 0; align-items: center; }
.warnings { background: #fee2e2; border-radius: 6px; padding: .5rem .75rem; }
pre.jd { white-space: pre-wrap; background: #fff; padding: 1rem; border-radius: 8px; font: .9rem/1.5 inherit; }
table { border-collapse: collapse; width: 100%; background: #fff; border-radius: 8px; }
td, th { text-align: left; padding: .5rem .75rem; border-bottom: 1px solid #e7e5e4; }
```

`packages/dashboard/app/layout.tsx`:

```tsx
import './globals.css'
import Link from 'next/link'
import type { ReactNode } from 'react'

export const metadata = { title: 'jobhunter' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <Link href="/">Queue</Link>
          <Link href="/tracker">Tracker</Link>
          <Link href="/health">Health</Link>
          <Link href="/settings">Settings</Link>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  )
}
```

- [ ] **Step 2: Implement the queue page**

`packages/dashboard/app/page.tsx`:

```tsx
import Link from 'next/link'
import { getDb } from '../lib/db'
import { queueJobs } from '../lib/data'

export const dynamic = 'force-dynamic'

export default async function QueuePage() {
  const db = await getDb()
  const jobs = await queueJobs(db, new Date().toISOString())
  if (jobs.length === 0) return <p>Queue is empty. Run a hunt.</p>
  return (
    <>
      {jobs.map((j) => (
        <div className="card" key={j.id}>
          <h2>
            <Link href={`/job/${j.id}`}>
              [{j.score}/10] {j.title}
            </Link>
            {j.draftFlag === 'drafted' && <span className="badge ready">draft ready</span>}
            {j.draftFlag === 'manual' && <span className="badge manual">write manually</span>}
          </h2>
          <p className="meta">
            {j.company} · {j.lane}
          </p>
          {j.verdict && <p>{j.verdict}</p>}
          {j.gaps.length > 0 && <p className="meta">gaps: {j.gaps.join('; ')}</p>}
        </div>
      ))}
    </>
  )
}
```

- [ ] **Step 3: Implement the detail page and its actions**

`packages/dashboard/app/job/[id]/actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getDb } from '../../../lib/db'
import { approveJob, skipJob, snoozeJob, markSubmitted, saveDraft } from '../../../lib/actions'

const jobId = (form: FormData) => Number(form.get('id'))

export async function approve(form: FormData) {
  await approveJob(await getDb(), jobId(form))
  revalidatePath('/')
  redirect('/')
}

export async function skip(form: FormData) {
  await skipJob(await getDb(), jobId(form))
  revalidatePath('/')
  redirect('/')
}

export async function snooze(form: FormData) {
  await snoozeJob(await getDb(), jobId(form), Number(form.get('days') ?? 3), new Date().toISOString())
  revalidatePath('/')
  redirect('/')
}

export async function submit(form: FormData) {
  await markSubmitted(await getDb(), jobId(form), new Date().toISOString())
  revalidatePath('/')
  redirect('/tracker')
}

export async function save(form: FormData) {
  const id = jobId(form)
  const count = Number(form.get('answerCount') ?? 0)
  const answers = Array.from({ length: count }, (_, i) => ({
    question: String(form.get(`q_${i}`) ?? ''),
    answer: String(form.get(`a_${i}`) ?? ''),
  }))
  const warnings = await saveDraft(await getDb(), id, String(form.get('coverLetter') ?? ''), answers)
  revalidatePath(`/job/${id}`)
  redirect(`/job/${id}?warnings=${encodeURIComponent(JSON.stringify(warnings))}`)
}
```

`packages/dashboard/app/job/[id]/page.tsx`:

```tsx
import { getDb } from '../../../lib/db'
import { getJob } from '../../../lib/data'
import { approve, skip, snooze, submit, save } from './actions'

export const dynamic = 'force-dynamic'

export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ warnings?: string }>
}) {
  const { id } = await params
  const { warnings: warningsParam } = await searchParams
  const db = await getDb()
  const job = await getJob(db, Number(id))
  if (!job) return <p>Job not found.</p>
  let warnings: string[] = []
  try {
    const parsed = JSON.parse(warningsParam ?? '[]')
    if (Array.isArray(parsed)) warnings = parsed.map(String)
  } catch {}
  return (
    <>
      <div className="card">
        <h2>
          [{job.score}/10] {job.title}
          <span className="badge">{job.status}</span>
        </h2>
        <p className="meta">
          {job.company} · {job.lane} · <a href={job.applyUrl}>apply link</a>
          {job.updatedAt && ` · posting updated ${job.updatedAt}`}
        </p>
        {job.verdict && <p>{job.verdict}</p>}
        {job.strengths.length > 0 && (
          <ul>
            {job.strengths.map((s, i) => (
              <li key={i}>
                {s.claim} <span className="meta">({s.evidence})</span>
              </li>
            ))}
          </ul>
        )}
        {job.gaps.length > 0 && <p className="meta">gaps: {job.gaps.join('; ')}</p>}
      </div>

      {job.status === 'queued' && (
        <div className="actions">
          <form action={approve}>
            <input type="hidden" name="id" value={job.id} />
            <button className="primary">Approve</button>
          </form>
          <form action={skip}>
            <input type="hidden" name="id" value={job.id} />
            <button>Skip</button>
          </form>
          <form action={snooze} className="actions">
            <input type="hidden" name="id" value={job.id} />
            <select name="days" defaultValue="3">
              <option value="1">1 day</option>
              <option value="3">3 days</option>
              <option value="7">7 days</option>
            </select>
            <button>Snooze</button>
          </form>
          <form action={submit}>
            <input type="hidden" name="id" value={job.id} />
            <button>Mark submitted</button>
          </form>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="warnings">
          <strong>Gate warnings (saved anyway):</strong>
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <form action={save}>
        <input type="hidden" name="id" value={job.id} />
        <input type="hidden" name="answerCount" value={job.answers.length} />
        <h3>Cover letter {job.draftFlag === 'manual' && <span className="badge manual">write manually</span>}</h3>
        <textarea name="coverLetter" defaultValue={job.coverLetter ?? ''} />
        {job.answers.map((a, i) => (
          <div key={i}>
            <h4>{a.question}</h4>
            <input type="hidden" name={`q_${i}`} value={a.question} />
            <textarea name={`a_${i}`} defaultValue={a.answer} />
          </div>
        ))}
        <div className="actions">
          <button className="primary">Save draft</button>
        </div>
      </form>

      <h3>Job description</h3>
      <pre className="jd">{job.description}</pre>
    </>
  )
}
```

- [ ] **Step 4: Verify**

Run: `pnpm test` (suite stays green — no new tests)
Run from repo root: `pnpm --filter @jobhunter/dashboard exec next build`
Expected: build succeeds with no type errors (this is the compile gate for the tsx).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard
git commit -m "Add queue and job detail pages"
```

---

### Task 5: Tracker and Health pages

**Files:**
- Create: `packages/dashboard/app/tracker/page.tsx`, `packages/dashboard/app/tracker/actions.ts`, `packages/dashboard/app/health/page.tsx`
- Test: none new (`trackerJobs`/`laneStats`/`sourceHealth` tested in Task 2, `tagResponded`/`tagRejected` in Task 3; `next build` is the compile gate).

**Interfaces:**
- Consumes: `getDb`, `trackerJobs`, `laneStats`, `sourceHealth` (T2); `tagResponded`, `tagRejected` (T3).
- Produces: routes `/tracker` and `/health`.

- [ ] **Step 1: Implement the tracker**

`packages/dashboard/app/tracker/actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { getDb } from '../../lib/db'
import { tagResponded, tagRejected } from '../../lib/actions'

export async function respond(form: FormData) {
  await tagResponded(await getDb(), Number(form.get('id')), new Date().toISOString())
  revalidatePath('/tracker')
}

export async function reject(form: FormData) {
  await tagRejected(await getDb(), Number(form.get('id')))
  revalidatePath('/tracker')
}
```

`packages/dashboard/app/tracker/page.tsx`:

```tsx
import { getDb } from '../../lib/db'
import { trackerJobs, laneStats } from '../../lib/data'
import { respond, reject } from './actions'

export const dynamic = 'force-dynamic'

export default async function TrackerPage() {
  const db = await getDb()
  const [jobs, stats] = await Promise.all([trackerJobs(db), laneStats(db)])
  return (
    <>
      <h2>Applications</h2>
      {jobs.length === 0 && <p>Nothing submitted yet.</p>}
      <table>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td>
                {j.title}
                <div className="meta">
                  {j.company} · {j.lane} · sent {j.submittedAt}
                </div>
              </td>
              <td>
                <span className={j.status === 'responded' ? 'badge ready' : j.status === 'rejected' ? 'badge warn' : 'badge'}>
                  {j.status}
                </span>
              </td>
              <td>
                {j.status === 'submitted' && (
                  <div className="actions">
                    <form action={respond}>
                      <input type="hidden" name="id" value={j.id} />
                      <button>Responded</button>
                    </form>
                    <form action={reject}>
                      <input type="hidden" name="id" value={j.id} />
                      <button>Rejected</button>
                    </form>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Per-lane response rate</h2>
      <table>
        <thead>
          <tr>
            <th>Lane</th>
            <th>Submitted</th>
            <th>Responded</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr key={s.lane}>
              <td>{s.lane}</td>
              <td>{s.submitted}</td>
              <td>{s.responded}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
```

- [ ] **Step 2: Implement health**

`packages/dashboard/app/health/page.tsx`:

```tsx
import { getDb } from '../../lib/db'
import { sourceHealth } from '../../lib/data'

export const dynamic = 'force-dynamic'

export default async function HealthPage() {
  const db = await getDb()
  const sources = await sourceHealth(db)
  if (sources.length === 0) return <p>No hunts recorded yet.</p>
  return (
    <table>
      <thead>
        <tr>
          <th>Source</th>
          <th>Last run</th>
          <th>Last success</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {sources.map((s) => (
          <tr key={s.source}>
            <td>{s.source}</td>
            <td>{s.lastRun}</td>
            <td>{s.lastOk ?? 'never'}</td>
            <td>
              {s.warning ? (
                <span className="badge warn">{s.consecutiveFailures} consecutive failures</span>
              ) : (
                <span className="badge ready">ok</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 3: Verify**

Run: `pnpm test` (green, unchanged count)
Run from repo root: `pnpm --filter @jobhunter/dashboard exec next build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard
git commit -m "Add tracker and health pages"
```

---

### Task 6: Settings page (screening facts, per-lane salary, config editor)

**Files:**
- Create: `packages/dashboard/lib/settings.ts`, `packages/dashboard/app/settings/page.tsx`, `packages/dashboard/app/settings/actions.ts`
- Test: `packages/dashboard/test/settings.test.ts`

**Interfaces:**
- Consumes: `getProfile`, `profileSchema`, `Profile` from `@jobhunter/hunter`; `configSchema` from `@jobhunter/core`; `getConfig`, `configPath` (T2); profile table.
- Produces:
  - `updateScreening(db, patch: Partial<Profile['screening']>): Promise<Profile>` — merges into the stored profile's screening, validates with `profileSchema`, upserts row id=1; throws `'no profile stored'` if none.
  - `validateConfigText(text: string): string | null` — returns null when the text parses and passes `configSchema`, else a one-line error message. (Pure; file write happens only in the server action.)

- [ ] **Step 1: Write the failing test**

`packages/dashboard/test/settings.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '@jobhunter/core'
import { getProfile } from '@jobhunter/hunter'
import { updateScreening, validateConfigText } from '../lib/settings.js'

const tmpDb = () => openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))

const baseProfile = {
  name: 'Jeremiah Ekanem',
  email: 'j@x.com',
  location: 'Lagos',
  links: [],
  skills: ['Flutter'],
  experience: [],
  education: [],
  screening: { noticePeriod: '30 days' },
}

async function seedProfile(db: Awaited<ReturnType<typeof tmpDb>>) {
  await db.execute({
    sql: "INSERT INTO profile(id, json, updated_at) VALUES (1, ?, datetime('now'))",
    args: [JSON.stringify(baseProfile)],
  })
}

describe('updateScreening', () => {
  it('merges the patch, keeps existing fields, and persists', async () => {
    const db = await tmpDb()
    await seedProfile(db)
    const updated = await updateScreening(db, {
      salaryExpectationsByLane: { 'remote-mobile': '$90k-$110k' },
      workAuthorization: 'Nigerian citizen, needs sponsorship abroad',
    })
    expect(updated.screening.noticePeriod).toBe('30 days')
    expect(updated.screening.salaryExpectationsByLane).toEqual({ 'remote-mobile': '$90k-$110k' })
    const roundTrip = await getProfile(db)
    expect(roundTrip?.screening.workAuthorization).toBe('Nigerian citizen, needs sponsorship abroad')
  })

  it('throws when no profile is stored', async () => {
    const db = await tmpDb()
    await expect(updateScreening(db, { noticePeriod: '2 weeks' })).rejects.toThrow('no profile stored')
  })
})

describe('validateConfigText', () => {
  it('accepts a valid config', () => {
    const valid = JSON.stringify({ lanes: [{ id: 'x', titlePatterns: ['a'], rule: 'any' }] })
    expect(validateConfigText(valid)).toBeNull()
  })

  it('rejects malformed JSON with a message', () => {
    expect(validateConfigText('{nope')).toMatch(/JSON/i)
  })

  it('rejects a config failing the schema', () => {
    expect(validateConfigText(JSON.stringify({ lanes: [] }))).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — cannot resolve `../lib/settings.js`

- [ ] **Step 3: Implement**

`packages/dashboard/lib/settings.ts`:

```ts
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
```

`packages/dashboard/app/settings/actions.ts`:

```ts
'use server'

import { readFileSync, writeFileSync } from 'node:fs'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getDb, getConfig, configPath } from '../../lib/db'
import { updateScreening, validateConfigText } from '../../lib/settings'

export async function saveScreening(form: FormData) {
  const lanes = getConfig().lanes
  const salaryExpectationsByLane: Record<string, string> = {}
  for (const lane of lanes) {
    const value = String(form.get(`salary_${lane.id}`) ?? '').trim()
    if (value) salaryExpectationsByLane[lane.id] = value
  }
  const text = (name: string) => {
    const v = String(form.get(name) ?? '').trim()
    return v === '' ? undefined : v
  }
  await updateScreening(await getDb(), {
    noticePeriod: text('noticePeriod'),
    salaryExpectation: text('salaryExpectation'),
    workAuthorization: text('workAuthorization'),
    salaryExpectationsByLane: Object.keys(salaryExpectationsByLane).length ? salaryExpectationsByLane : undefined,
  })
  revalidatePath('/settings')
  redirect('/settings?saved=1')
}

export async function saveConfig(form: FormData) {
  const text = String(form.get('configText') ?? '')
  const error = validateConfigText(text)
  if (error) redirect(`/settings?error=${encodeURIComponent(error)}`)
  writeFileSync(configPath, text)
  revalidatePath('/settings')
  redirect('/settings?saved=1')
}
```

(`readFileSync` is unused in this file — import only `writeFileSync`.)

`packages/dashboard/app/settings/page.tsx`:

```tsx
import { getDb, getConfig } from '../../lib/db'
import { getProfile } from '@jobhunter/hunter'
import { readFileSync } from 'node:fs'
import { configPath } from '../../lib/db'
import { saveScreening, saveConfig } from './actions'

export const dynamic = 'force-dynamic'

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>
}) {
  const { saved, error } = await searchParams
  const db = await getDb()
  const profile = await getProfile(db)
  const config = getConfig()
  const configText = readFileSync(configPath, 'utf8')
  const screening = profile?.screening ?? {}
  return (
    <>
      {saved && <p className="badge ready">Saved.</p>}
      {error && <p className="warnings">{error}</p>}

      <h2>Screening facts</h2>
      {!profile && <p>No profile yet — run parse-resume first.</p>}
      {profile && (
        <form action={saveScreening} className="card">
          <h4>Notice period</h4>
          <input type="text" name="noticePeriod" defaultValue={screening.noticePeriod ?? ''} />
          <h4>Work authorization</h4>
          <input type="text" name="workAuthorization" defaultValue={screening.workAuthorization ?? ''} />
          <h4>General salary expectation (fallback)</h4>
          <input type="text" name="salaryExpectation" defaultValue={screening.salaryExpectation ?? ''} />
          <h4>Per-lane salary expectations</h4>
          {config.lanes.map((lane) => (
            <div key={lane.id}>
              <label className="meta">{lane.id}</label>
              <input
                type="text"
                name={`salary_${lane.id}`}
                defaultValue={screening.salaryExpectationsByLane?.[lane.id] ?? ''}
              />
            </div>
          ))}
          <div className="actions">
            <button className="primary">Save screening</button>
          </div>
        </form>
      )}

      <h2>Config (lanes, blocklist)</h2>
      <form action={saveConfig} className="card">
        <textarea name="configText" defaultValue={configText} style={{ minHeight: '16rem' }} />
        <div className="actions">
          <button className="primary">Validate and save</button>
        </div>
      </form>
    </>
  )
}
```

Note: text inputs need `input[type=text] { width: 100%; font: inherit; padding: .4rem .5rem; border: 1px solid #d6d3d1; border-radius: 6px; }` added to `globals.css` in this task.

- [ ] **Step 4: Run tests to verify pass, then build**

Run: `pnpm test`
Expected: PASS (all suites)
Run from repo root: `pnpm --filter @jobhunter/dashboard exec next build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard
git commit -m "Add settings page with screening and config editors"
```

---

## Verification checklist (run after all tasks)

- `pnpm test` — entire suite green (existing 80 + ~17 new).
- `pnpm --filter @jobhunter/dashboard exec next build` — clean production build, no type errors.
- Live smoke (controller, manual): `pnpm dashboard` → browse Queue (promote a scored job temporarily if empty), open Detail, edit the cover letter to include an em-dash and a fabricated number → Save → gate warnings render but text saved; Snooze hides a job from the queue; Approve moves status; Tracker tags respond/reject; Health shows both sources; Settings saves a per-lane salary and round-trips it; a follow-up `jobhunter draft` on a fresh queued job cites the configured expectation. Restore any temporarily promoted job.
- Spec cross-check: queue cards with score/lane/company/evidence/gaps ✓; detail with JD beside editable drafts, Approve/Skip/Snooze ✓; tracker with response tagging and per-lane stats ✓; health with last hunt + per-source status and 3-consecutive-failure warning ✓; settings with lanes/blocklist config + profile editor ✓; salary three-tier rule in drafter ✓. Deferred to Plan 5: auth, Vercel deploy, Turso. Deferred to Plan 4: applier pickup of `approved` jobs.
- Workflow: all commits on the feature branch; PR opened into `dev`; no direct pushes to main/dev; no attribution trailers.
