# Jobhunter Core Engine Implementation Plan (Plan 1 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working hunt pipeline: `jobhunter hunt` pulls jobs from Greenhouse boards and Remotive, filters them into Jeremiah's lanes, LLM-scores the survivors against his parsed resume, and `jobhunter queue` lists what's worth applying to.

**Architecture:** pnpm monorepo, TypeScript run directly with tsx (no build step). `@jobhunter/core` holds config, DB (libSQL), and the Claude CLI wrapper; `@jobhunter/hunter` holds source adapters and pipeline stages. All LLM calls shell out to headless Claude Code (`claude -p`) so they ride the existing subscription. SQLite file locally; the same libSQL client speaks to Turso later (Plan 5).

**Tech Stack:** Node 22, pnpm workspaces, TypeScript (strict), tsx, vitest, zod, @libsql/client.

**Later plans (do not build here):** Plan 2 drafter + fact-lock/style-lint, Plan 3 Next.js dashboard, Plan 4 Playwright applier, Plan 5 remaining adapters + GitHub Actions + Turso.

## Global Constraints

- Strictly $0 extra spend: free APIs only; LLM via `claude -p` on the existing subscription, never the metered API.
- Never automate LinkedIn; never POST applications to third-party ATS endpoints. This plan only ever GETs public job data.
- Politeness: ≥1s between requests to the same host; exponential backoff on 429.
- LLM score cap: 30 jobs per hunt, newest-first (config `scoreCapPerHunt`).
- Queue threshold: score ≥ 7 (config `queueThreshold`); company cooldown 14 days (config `companyCooldownDays`).
- Job status values (exact strings): `sourced`, `filtered_out`, `matched`, `scored`, `score_failed`, `queued`, `approved`, `submitted`, `responded`, `rejected`, `stale`.
- No code comments unless genuinely non-obvious. No `Co-Authored-By` or AI attribution in commits.
- Every commit message is plain imperative ("Add rules filter"), one concern per commit.

---

### Task 1: Monorepo scaffold + config loader

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `tsconfig.json`, `.gitignore`, `vitest.config.ts`
- Create: `packages/core/package.json`, `packages/core/src/config.ts`, `packages/core/src/index.ts`
- Create: `jobhunter.config.json`
- Test: `packages/core/test/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(path?: string): Config` and the `Config` type — every later task consumes `Config`. Key fields: `dbUrl: string`, `claudeBin: string`, `scoreCapPerHunt: number`, `queueThreshold: number`, `companyCooldownDays: number`, `blocklist: string[]`, `lanes: Lane[]` where `Lane = { id: string; titlePatterns: string[]; seniorityPatterns: string[]; rule: 'remote'|'visa'|'nigeria'|'any' }`, `remoteExcludePatterns: string[]`, `visaPatterns: string[]`.

- [ ] **Step 1: Scaffold the workspace**

```bash
cd ~/jobhunter
printf 'packages:\n  - "packages/*"\n' > pnpm-workspace.yaml
```

Root `package.json`:

```json
{
  "name": "jobhunter",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "jobhunter": "tsx packages/hunter/src/cli.ts"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["packages/*/src/**/*.ts", "packages/*/test/**/*.ts"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['packages/*/test/**/*.test.ts'] } })
```

`.gitignore`:

```
node_modules/
jobhunter.db*
.env
```

`packages/core/package.json`:

```json
{
  "name": "@jobhunter/core",
  "type": "module",
  "main": "src/index.ts",
  "dependencies": {
    "@libsql/client": "^0.14.0",
    "zod": "^3.24.0"
  },
  "devDependencies": { "@types/node": "^22.0.0" }
}
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing test**

`packages/core/test/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../src/config.js'

const validConfig = {
  lanes: [{ id: 'remote-mobile', titlePatterns: ['flutter', 'mobile'], rule: 'remote' }],
}

function writeTmp(obj: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'jh-'))
  const p = join(dir, 'config.json')
  writeFileSync(p, JSON.stringify(obj))
  return p
}

describe('loadConfig', () => {
  it('parses a valid config and applies defaults', () => {
    const config = loadConfig(writeTmp(validConfig))
    expect(config.dbUrl).toBe('file:jobhunter.db')
    expect(config.scoreCapPerHunt).toBe(30)
    expect(config.queueThreshold).toBe(7)
    expect(config.companyCooldownDays).toBe(14)
    expect(config.lanes[0].seniorityPatterns).toContain('senior')
    expect(config.visaPatterns.length).toBeGreaterThan(0)
  })

  it('rejects a config with no lanes', () => {
    expect(() => loadConfig(writeTmp({ lanes: [] }))).toThrow()
  })

  it('rejects an unknown lane rule', () => {
    expect(() =>
      loadConfig(writeTmp({ lanes: [{ id: 'x', titlePatterns: ['a'], rule: 'nope' }] })),
    ).toThrow()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — cannot resolve `../src/config.js`

- [ ] **Step 4: Implement the config loader**

`packages/core/src/config.ts`:

```ts
import { readFileSync } from 'node:fs'
import { z } from 'zod'

const laneSchema = z.object({
  id: z.string(),
  titlePatterns: z.array(z.string()).nonempty(),
  seniorityPatterns: z.array(z.string()).default(['senior', 'staff', 'lead', 'principal']),
  rule: z.enum(['remote', 'visa', 'nigeria', 'any']),
})

export const configSchema = z.object({
  dbUrl: z.string().default('file:jobhunter.db'),
  dbAuthToken: z.string().optional(),
  claudeBin: z.string().default('claude'),
  scoreCapPerHunt: z.number().int().positive().default(30),
  queueThreshold: z.number().int().min(1).max(10).default(7),
  companyCooldownDays: z.number().int().positive().default(14),
  blocklist: z.array(z.string()).default([]),
  lanes: z.array(laneSchema).nonempty(),
  remoteExcludePatterns: z
    .array(z.string())
    .default(['US[- ]?only', 'United States only', 'EU only', 'UK only', 'US citizens?', 'based in the (US|EU|UK)']),
  visaPatterns: z
    .array(z.string())
    .default(['visa sponsorship', 'relocation (support|assistance|package)', 'work permit assistance', 'sponsorship (is )?available']),
})

export type Config = z.infer<typeof configSchema>
export type Lane = z.infer<typeof laneSchema>

export function loadConfig(path = 'jobhunter.config.json'): Config {
  return configSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
}
```

`packages/core/src/index.ts`:

```ts
export * from './config.js'
```

Also create the real `jobhunter.config.json` at repo root:

```json
{
  "lanes": [
    { "id": "remote-mobile", "titlePatterns": ["flutter", "mobile engineer", "mobile developer", "ios", "android", "react native"], "rule": "remote" },
    { "id": "remote-frontend", "titlePatterns": ["frontend", "front[- ]end", "full[- ]?stack", "react", "next\\.?js"], "rule": "remote" },
    { "id": "visa-anywhere", "titlePatterns": ["flutter", "mobile", "frontend", "full[- ]?stack", "react"], "rule": "visa" },
    { "id": "nigeria-local", "titlePatterns": ["flutter", "mobile", "frontend", "full[- ]?stack", "react", "software engineer"], "rule": "nigeria" }
  ],
  "blocklist": []
}
```

- [ ] **Step 5: Run tests to verify pass, then commit**

Run: `pnpm test`
Expected: PASS (3 tests)

```bash
git add -A
git commit -m "Scaffold monorepo and add config loader"
```

---

### Task 2: Database schema + client

**Files:**
- Create: `packages/core/src/db.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './db.js'`)
- Test: `packages/core/test/db.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `openDb(url: string, authToken?: string): Promise<Client>` (libSQL `Client`, already migrated). Tables and exact columns later tasks rely on:
  - `companies(id, ats, slug, name, last_seen)` — UNIQUE(ats, slug)
  - `jobs(id, external_key UNIQUE, title, company, location, remote, salary, description, apply_url, source, ats_family, lane, posted_at, first_seen, updated_at, status DEFAULT 'sourced', score, score_json, cover_letter, answers_json, draft_flag, submitted_at, responded_at)`
  - `runs(id, started_at, finished_at, source, ok, error, jobs_found)`
  - `profile(id CHECK (id=1), json, updated_at)`

- [ ] **Step 1: Write the failing test**

`packages/core/test/db.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db.js'

const tmpUrl = () => 'file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 'test.db')

describe('openDb', () => {
  it('creates all tables', async () => {
    const db = await openDb(tmpUrl())
    const rs = await db.execute("SELECT name FROM sqlite_master WHERE type='table'")
    const names = rs.rows.map((r) => r.name)
    for (const t of ['companies', 'jobs', 'runs', 'profile']) expect(names).toContain(t)
  })

  it('is idempotent when opened twice on the same file', async () => {
    const url = tmpUrl()
    await openDb(url)
    const db = await openDb(url)
    await db.execute("INSERT INTO companies(ats, slug) VALUES ('greenhouse', 'stripe')")
    const rs = await db.execute('SELECT COUNT(*) AS n FROM companies')
    expect(rs.rows[0].n).toBe(1)
  })

  it('enforces unique jobs.external_key', async () => {
    const db = await openDb(tmpUrl())
    const sql =
      "INSERT INTO jobs(external_key, title, company, description, apply_url, source, first_seen) VALUES ('a:1','t','c','d','u','s','2026-08-11')"
    await db.execute(sql)
    await expect(db.execute(sql)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — cannot resolve `../src/db.js`

- [ ] **Step 3: Implement**

`packages/core/src/db.ts`:

```ts
import { createClient, type Client } from '@libsql/client'

const MIGRATIONS = [
  `CREATE TABLE companies(
    id INTEGER PRIMARY KEY,
    ats TEXT NOT NULL,
    slug TEXT NOT NULL,
    name TEXT,
    last_seen TEXT,
    UNIQUE(ats, slug)
  )`,
  `CREATE TABLE jobs(
    id INTEGER PRIMARY KEY,
    external_key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT,
    remote INTEGER DEFAULT 0,
    salary TEXT,
    description TEXT NOT NULL,
    apply_url TEXT NOT NULL,
    source TEXT NOT NULL,
    ats_family TEXT,
    lane TEXT,
    posted_at TEXT,
    first_seen TEXT NOT NULL,
    updated_at TEXT,
    status TEXT NOT NULL DEFAULT 'sourced',
    score INTEGER,
    score_json TEXT,
    cover_letter TEXT,
    answers_json TEXT,
    draft_flag TEXT,
    submitted_at TEXT,
    responded_at TEXT
  )`,
  `CREATE TABLE runs(
    id INTEGER PRIMARY KEY,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    source TEXT NOT NULL,
    ok INTEGER,
    error TEXT,
    jobs_found INTEGER
  )`,
  `CREATE TABLE profile(
    id INTEGER PRIMARY KEY CHECK (id = 1),
    json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
]

export async function openDb(url: string, authToken?: string): Promise<Client> {
  const db = createClient({ url, authToken })
  await db.execute('CREATE TABLE IF NOT EXISTS schema_version(v INTEGER NOT NULL)')
  const rs = await db.execute('SELECT MAX(v) AS v FROM schema_version')
  const current = (rs.rows[0]?.v as number | null) ?? 0
  for (let i = current; i < MIGRATIONS.length; i++) {
    await db.execute(MIGRATIONS[i])
    await db.execute({ sql: 'INSERT INTO schema_version(v) VALUES (?)', args: [i + 1] })
  }
  return db
}
```

Add to `packages/core/src/index.ts`: `export * from './db.js'`

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "Add database schema and migration-on-open client"
```

---

### Task 3: Job ingestion (normalize + dedupe + upsert)

**Files:**
- Create: `packages/hunter/package.json`, `packages/hunter/src/types.ts`, `packages/hunter/src/pipeline/ingest.ts`
- Test: `packages/hunter/test/ingest.test.ts`

**Interfaces:**
- Consumes: `openDb` from `@jobhunter/core`.
- Produces:
  - `RawJob` type: `{ externalId: string; title: string; company: string; location?: string; remote?: boolean; salary?: string; description: string; applyUrl: string; source: string; atsFamily?: string; postedAt?: string }`
  - `stripHtml(html: string): string`
  - `ingestJobs(db: Client, raws: RawJob[], now: string): Promise<{ inserted: number; updated: number; skipped: number }>` — external key is `` `${source}:${externalId}` ``; cross-board duplicates (same lowercased company+title) resolve in favor of a direct-ATS source over an aggregator.

- [ ] **Step 1: Create the hunter package**

`packages/hunter/package.json`:

```json
{
  "name": "@jobhunter/hunter",
  "type": "module",
  "main": "src/index.ts",
  "dependencies": {
    "@jobhunter/core": "workspace:*",
    "zod": "^3.24.0"
  },
  "devDependencies": { "@types/node": "^22.0.0" }
}
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing test**

`packages/hunter/test/ingest.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '@jobhunter/core'
import { ingestJobs, stripHtml } from '../src/pipeline/ingest.js'
import type { RawJob } from '../src/types.js'

const NOW = '2026-08-11T09:00:00Z'
const tmpDb = () => openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))

const base: RawJob = {
  externalId: '123',
  title: 'Senior Flutter Engineer',
  company: 'Acme',
  description: 'Build apps',
  applyUrl: 'https://boards.greenhouse.io/acme/jobs/123',
  source: 'greenhouse',
  atsFamily: 'greenhouse',
}

describe('stripHtml', () => {
  it('removes tags and decodes basic entities', () => {
    expect(stripHtml('<p>Dart &amp; Flutter</p>')).toBe('Dart & Flutter')
  })
})

describe('ingestJobs', () => {
  it('inserts new jobs with status sourced', async () => {
    const db = await tmpDb()
    const res = await ingestJobs(db, [base], NOW)
    expect(res).toEqual({ inserted: 1, updated: 0, skipped: 0 })
    const rs = await db.execute('SELECT status, external_key FROM jobs')
    expect(rs.rows[0].status).toBe('sourced')
    expect(rs.rows[0].external_key).toBe('greenhouse:123')
  })

  it('updates an existing job by external key instead of duplicating', async () => {
    const db = await tmpDb()
    await ingestJobs(db, [base], NOW)
    const res = await ingestJobs(db, [{ ...base, description: 'Updated' }], NOW)
    expect(res.updated).toBe(1)
    const rs = await db.execute('SELECT COUNT(*) AS n FROM jobs')
    expect(rs.rows[0].n).toBe(1)
  })

  it('prefers direct-ATS record over aggregator duplicate of same company+title', async () => {
    const db = await tmpDb()
    const aggregator: RawJob = { ...base, externalId: 'r9', source: 'remotive', atsFamily: undefined, applyUrl: 'https://remotive.com/j/9' }
    await ingestJobs(db, [aggregator], NOW)
    const res = await ingestJobs(db, [base], NOW)
    expect(res.updated).toBe(1)
    const rs = await db.execute('SELECT source, apply_url, COUNT(*) OVER () AS n FROM jobs')
    expect(rs.rows[0].n).toBe(1)
    expect(rs.rows[0].source).toBe('greenhouse')
  })

  it('skips aggregator duplicate when direct-ATS record already exists', async () => {
    const db = await tmpDb()
    await ingestJobs(db, [base], NOW)
    const aggregator: RawJob = { ...base, externalId: 'r9', source: 'remotive', atsFamily: undefined, applyUrl: 'https://remotive.com/j/9' }
    const res = await ingestJobs(db, [aggregator], NOW)
    expect(res.skipped).toBe(1)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — cannot resolve `../src/pipeline/ingest.js`

- [ ] **Step 4: Implement**

`packages/hunter/src/types.ts`:

```ts
export type RawJob = {
  externalId: string
  title: string
  company: string
  location?: string
  remote?: boolean
  salary?: string
  description: string
  applyUrl: string
  source: string
  atsFamily?: string
  postedAt?: string
}
```

`packages/hunter/src/pipeline/ingest.ts`:

```ts
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
```

Note: `dupeKey` exists for readability; if unused after implementation, delete it rather than exporting dead code.

Create `packages/hunter/src/index.ts`:

```ts
export * from './types.js'
export * from './pipeline/ingest.js'
```

- [ ] **Step 5: Run tests to verify pass, then commit**

Run: `pnpm test`
Expected: PASS

```bash
git add packages/hunter pnpm-lock.yaml
git commit -m "Add job ingestion with cross-board dedupe"
```

---

### Task 4: Rules filter

**Files:**
- Create: `packages/hunter/src/pipeline/filter.ts`
- Modify: `packages/hunter/src/index.ts` (add `export * from './pipeline/filter.js'`)
- Test: `packages/hunter/test/filter.test.ts`

**Interfaces:**
- Consumes: `Config`, `Lane` from `@jobhunter/core`; jobs table.
- Produces:
  - `matchLane(job: { title: string; company: string; location: string | null; remote: number; description: string }, config: Config): string | null` — returns lane id or null. Pure function.
  - `runFilter(db: Client, config: Config): Promise<{ matched: number; filteredOut: number }>` — moves every `sourced` job to `matched` (with `lane` set) or `filtered_out`.

- [ ] **Step 1: Write the failing test**

`packages/hunter/test/filter.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, configSchema } from '@jobhunter/core'
import { matchLane, runFilter } from '../src/pipeline/filter.js'
import { ingestJobs } from '../src/pipeline/ingest.js'
import type { RawJob } from '../src/types.js'

const config = configSchema.parse({
  blocklist: ['evilcorp'],
  lanes: [
    { id: 'remote-mobile', titlePatterns: ['flutter', 'mobile'], rule: 'remote' },
    { id: 'visa-anywhere', titlePatterns: ['flutter', 'frontend'], rule: 'visa' },
    { id: 'nigeria-local', titlePatterns: ['software engineer', 'frontend'], rule: 'nigeria' },
  ],
})

const job = (over: Partial<Parameters<typeof matchLane>[0]>) => ({
  title: 'Senior Flutter Engineer',
  company: 'Acme',
  location: 'Remote',
  remote: 1,
  description: 'Work from anywhere.',
  ...over,
})

describe('matchLane', () => {
  it('matches a senior remote flutter role to remote-mobile', () => {
    expect(matchLane(job({}), config)).toBe('remote-mobile')
  })
  it('rejects non-senior titles', () => {
    expect(matchLane(job({ title: 'Junior Flutter Developer' }), config)).toBeNull()
  })
  it('rejects blocklisted companies', () => {
    expect(matchLane(job({ company: 'EvilCorp' }), config)).toBeNull()
  })
  it('rejects remote roles restricted to the US', () => {
    expect(matchLane(job({ description: 'Remote, US only.' }), config)).toBeNull()
  })
  it('matches an onsite role mentioning visa sponsorship to visa-anywhere', () => {
    const j = job({ title: 'Senior Frontend Engineer', location: 'Berlin', remote: 0, description: 'We offer visa sponsorship.' })
    expect(matchLane(j, config)).toBe('visa-anywhere')
  })
  it('matches a Lagos role to nigeria-local', () => {
    const j = job({ title: 'Senior Software Engineer', location: 'Lagos, Nigeria', remote: 0 })
    expect(matchLane(j, config)).toBe('nigeria-local')
  })
  it('returns null when nothing applies', () => {
    expect(matchLane(job({ title: 'Senior Accountant' }), config)).toBeNull()
  })
})

describe('runFilter', () => {
  it('splits sourced jobs into matched and filtered_out', async () => {
    const db = await openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))
    const raws: RawJob[] = [
      { externalId: '1', title: 'Senior Flutter Engineer', company: 'A', description: 'Anywhere', applyUrl: 'u1', source: 's', remote: true, location: 'Remote' },
      { externalId: '2', title: 'Senior Accountant', company: 'B', description: 'x', applyUrl: 'u2', source: 's' },
    ]
    await ingestJobs(db, raws, '2026-08-11T09:00:00Z')
    const res = await runFilter(db, config)
    expect(res).toEqual({ matched: 1, filteredOut: 1 })
    const rs = await db.execute("SELECT status, lane FROM jobs WHERE external_key='s:1'")
    expect(rs.rows[0].status).toBe('matched')
    expect(rs.rows[0].lane).toBe('remote-mobile')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — cannot resolve `../src/pipeline/filter.js`

- [ ] **Step 3: Implement**

`packages/hunter/src/pipeline/filter.ts`:

```ts
import type { Client } from '@libsql/client'
import type { Config } from '@jobhunter/core'

type FilterableJob = {
  title: string
  company: string
  location: string | null
  remote: number
  description: string
}

const anyMatch = (patterns: string[], text: string) =>
  patterns.some((p) => new RegExp(p, 'i').test(text))

export function matchLane(job: FilterableJob, config: Config): string | null {
  if (config.blocklist.some((b) => job.company.toLowerCase().includes(b.toLowerCase()))) return null
  const haystack = `${job.location ?? ''} ${job.description}`
  for (const lane of config.lanes) {
    if (!anyMatch(lane.titlePatterns, job.title)) continue
    if (!anyMatch(lane.seniorityPatterns, job.title)) continue
    switch (lane.rule) {
      case 'remote': {
        const isRemote = job.remote === 1 || /remote/i.test(job.location ?? '')
        if (isRemote && !anyMatch(config.remoteExcludePatterns, haystack)) return lane.id
        break
      }
      case 'visa':
        if (anyMatch(config.visaPatterns, job.description)) return lane.id
        break
      case 'nigeria':
        if (/nigeria|lagos|abuja/i.test(job.location ?? '')) return lane.id
        break
      case 'any':
        return lane.id
    }
  }
  return null
}

export async function runFilter(db: Client, config: Config) {
  const rs = await db.execute(
    "SELECT id, title, company, location, remote, description FROM jobs WHERE status='sourced'",
  )
  let matched = 0, filteredOut = 0
  for (const row of rs.rows) {
    const lane = matchLane(row as unknown as FilterableJob, config)
    if (lane) {
      await db.execute({ sql: "UPDATE jobs SET status='matched', lane=? WHERE id=?", args: [lane, row.id] })
      matched++
    } else {
      await db.execute({ sql: "UPDATE jobs SET status='filtered_out' WHERE id=?", args: [row.id] })
      filteredOut++
    }
  }
  return { matched, filteredOut }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/hunter
git commit -m "Add lane rules filter"
```

---

### Task 5: Claude CLI wrapper

**Files:**
- Create: `packages/core/src/claude.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './claude.js'`)
- Test: `packages/core/test/claude.test.ts`, `packages/core/test/fixtures/fake-claude.sh`

**Interfaces:**
- Consumes: nothing.
- Produces: `invokeClaude<T>(opts: { prompt: string; model: 'haiku' | 'sonnet'; schema: ZodType<T>; claudeBin?: string; allowedTools?: string[] }): Promise<T>`. Spawns `claude -p <prompt> --model <model> --output-format json [--allowedTools ...]`, parses the CLI's JSON envelope (`{ result: string }`), extracts the first `{...}` block from `result`, validates with the zod schema. On any failure, retries exactly once with the validation error appended to the prompt; then throws `ClaudeInvocationError`. Later tasks inject this function as `invoke` for testability.

- [ ] **Step 1: Write the failing test**

`packages/core/test/fixtures/fake-claude.sh`:

```bash
#!/bin/bash
# Emits the file named by FAKE_CLAUDE_OUTPUT, or after the first call the file
# named by FAKE_CLAUDE_OUTPUT_2 if set (call count kept in FAKE_CLAUDE_COUNTER file).
count_file="${FAKE_CLAUDE_COUNTER:-/tmp/fake-claude-count}"
n=$(cat "$count_file" 2>/dev/null || echo 0)
echo $((n + 1)) > "$count_file"
if [ "$n" -ge 1 ] && [ -n "$FAKE_CLAUDE_OUTPUT_2" ]; then
  cat "$FAKE_CLAUDE_OUTPUT_2"
else
  cat "$FAKE_CLAUDE_OUTPUT"
fi
```

Run: `chmod +x packages/core/test/fixtures/fake-claude.sh`

`packages/core/test/claude.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { invokeClaude, ClaudeInvocationError } from '../src/claude.js'

const BIN = join(import.meta.dirname, 'fixtures', 'fake-claude.sh')
const schema = z.object({ score: z.number() })
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jh-claude-'))
  process.env.FAKE_CLAUDE_COUNTER = join(dir, 'count')
  delete process.env.FAKE_CLAUDE_OUTPUT_2
})

const envelope = (result: string) => JSON.stringify({ result })

function setOutput(name: 'FAKE_CLAUDE_OUTPUT' | 'FAKE_CLAUDE_OUTPUT_2', content: string) {
  const p = join(dir, name)
  writeFileSync(p, content)
  process.env[name] = p
}

describe('invokeClaude', () => {
  it('parses and validates a clean JSON response', async () => {
    setOutput('FAKE_CLAUDE_OUTPUT', envelope('{"score": 8}'))
    const out = await invokeClaude({ prompt: 'p', model: 'haiku', schema, claudeBin: BIN })
    expect(out).toEqual({ score: 8 })
  })

  it('extracts JSON wrapped in prose or code fences', async () => {
    setOutput('FAKE_CLAUDE_OUTPUT', envelope('Here you go:\n```json\n{"score": 6}\n```'))
    const out = await invokeClaude({ prompt: 'p', model: 'haiku', schema, claudeBin: BIN })
    expect(out).toEqual({ score: 6 })
  })

  it('retries once on invalid output, then succeeds', async () => {
    setOutput('FAKE_CLAUDE_OUTPUT', envelope('{"score": "high"}'))
    setOutput('FAKE_CLAUDE_OUTPUT_2', envelope('{"score": 7}'))
    const out = await invokeClaude({ prompt: 'p', model: 'haiku', schema, claudeBin: BIN })
    expect(out).toEqual({ score: 7 })
  })

  it('throws ClaudeInvocationError after two invalid outputs', async () => {
    setOutput('FAKE_CLAUDE_OUTPUT', envelope('not json at all'))
    await expect(
      invokeClaude({ prompt: 'p', model: 'haiku', schema, claudeBin: BIN }),
    ).rejects.toThrow(ClaudeInvocationError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — cannot resolve `../src/claude.js`

- [ ] **Step 3: Implement**

`packages/core/src/claude.ts`:

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ZodType } from 'zod'

const exec = promisify(execFile)

export class ClaudeInvocationError extends Error {}

export type InvokeClaude = <T>(opts: {
  prompt: string
  model: 'haiku' | 'sonnet'
  schema: ZodType<T>
  claudeBin?: string
  allowedTools?: string[]
}) => Promise<T>

function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('no JSON object found in response')
  return JSON.parse(text.slice(start, end + 1))
}

async function callOnce(prompt: string, model: string, bin: string, allowedTools?: string[]) {
  const args = ['-p', prompt, '--model', model, '--output-format', 'json']
  if (allowedTools?.length) args.push('--allowedTools', allowedTools.join(','))
  const { stdout } = await exec(bin, args, { maxBuffer: 32 * 1024 * 1024 })
  const envelope = JSON.parse(stdout) as { result?: string }
  if (typeof envelope.result !== 'string') throw new Error('missing result in claude output')
  return envelope.result
}

export const invokeClaude: InvokeClaude = async ({ prompt, model, schema, claudeBin = 'claude', allowedTools }) => {
  let lastError: unknown
  let currentPrompt = prompt
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await callOnce(currentPrompt, model, claudeBin, allowedTools)
      return schema.parse(extractJson(result))
    } catch (err) {
      lastError = err
      currentPrompt = `${prompt}\n\nYour previous reply failed validation: ${String(err)}\nReply with ONLY a valid JSON object matching the schema. No prose, no code fences.`
    }
  }
  throw new ClaudeInvocationError(`claude invocation failed after retry: ${String(lastError)}`)
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "Add headless Claude CLI wrapper with schema validation and retry"
```

---

### Task 6: Resume profile parsing

**Files:**
- Create: `packages/hunter/src/profile.ts`
- Modify: `packages/hunter/src/index.ts` (add `export * from './profile.js'`)
- Test: `packages/hunter/test/profile.test.ts`

**Interfaces:**
- Consumes: `invokeClaude` (injected), `openDb`, profile table.
- Produces:
  - `profileSchema` (zod) and `Profile` type: `{ name: string; email: string; phone?: string; location: string; links: string[]; skills: string[]; experience: { company: string; title: string; start: string; end: string | null; highlights: string[] }[]; education: { school: string; credential: string }[]; screening: { noticePeriod?: string; salaryExpectation?: string; workAuthorization?: string } }`
  - `parseResume(db: Client, pdfPath: string, config: Config, invoke: InvokeClaude): Promise<Profile>` — stores JSON in profile row id=1 (upsert).
  - `getProfile(db: Client): Promise<Profile | null>`

- [ ] **Step 1: Write the failing test**

`packages/hunter/test/profile.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, configSchema, type InvokeClaude } from '@jobhunter/core'
import { parseResume, getProfile } from '../src/profile.js'

const config = configSchema.parse({ lanes: [{ id: 'x', titlePatterns: ['a'], rule: 'any' }] })
const tmpDb = () => openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))

const canned = {
  name: 'Jeremiah Ekanem',
  email: 'j@example.com',
  location: 'Lagos, Nigeria',
  links: [],
  skills: ['Flutter', 'Dart', 'React'],
  experience: [{ company: 'Heirs', title: 'Senior Flutter Engineer', start: '2026-02', end: null, highlights: ['Cold start 11.4s to 2.1s'] }],
  education: [],
  screening: {},
}

const fakeInvoke = ((opts: { prompt: string }) => {
  expect(opts.prompt).toContain('/fake/resume.pdf')
  return Promise.resolve(canned)
}) as unknown as InvokeClaude

describe('parseResume', () => {
  it('stores the parsed profile and getProfile round-trips it', async () => {
    const db = await tmpDb()
    const profile = await parseResume(db, '/fake/resume.pdf', config, fakeInvoke)
    expect(profile.name).toBe('Jeremiah Ekanem')
    expect(await getProfile(db)).toEqual(canned)
  })

  it('overwrites on re-parse instead of failing', async () => {
    const db = await tmpDb()
    await parseResume(db, '/fake/resume.pdf', config, fakeInvoke)
    await parseResume(db, '/fake/resume.pdf', config, fakeInvoke)
    const rs = await db.execute('SELECT COUNT(*) AS n FROM profile')
    expect(rs.rows[0].n).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — cannot resolve `../src/profile.js`

- [ ] **Step 3: Implement**

`packages/hunter/src/profile.ts`:

```ts
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
  screening: z
    .object({
      noticePeriod: z.string().optional(),
      salaryExpectation: z.string().optional(),
      workAuthorization: z.string().optional(),
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

export async function parseResume(db: Client, pdfPath: string, config: Config, invoke: InvokeClaude): Promise<Profile> {
  const profile = await invoke({
    prompt: PARSE_PROMPT(pdfPath),
    model: 'sonnet',
    schema: profileSchema,
    claudeBin: config.claudeBin,
    allowedTools: ['Read'],
  })
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
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/hunter
git commit -m "Add resume profile parsing via headless Claude"
```

---

### Task 7: Adapter interface, throttled fetch, Greenhouse adapter, company seeding

**Files:**
- Create: `packages/hunter/src/sources/types.ts`, `packages/hunter/src/net.ts`, `packages/hunter/src/sources/greenhouse.ts`, `packages/hunter/src/seed.ts`, `data/companies-seed.csv`
- Modify: `packages/hunter/src/index.ts` (export the new modules)
- Test: `packages/hunter/test/net.test.ts`, `packages/hunter/test/greenhouse.test.ts`, `packages/hunter/test/seed.test.ts`, `packages/hunter/test/fixtures/greenhouse-jobs.json`

**Interfaces:**
- Consumes: `RawJob`, companies table.
- Produces:
  - `AdapterCtx = { db: Client; config: Config; fetchJson(url: string): Promise<unknown> }`
  - `SourceAdapter = { name: string; fetchJobs(ctx: AdapterCtx): Promise<RawJob[]> }`
  - `makeThrottledFetch(opts?: { minIntervalMs?: number; sleep?: (ms: number) => Promise<void>; fetchImpl?: typeof fetch }): (url: string) => Promise<unknown>` — ≥1s gap per hostname, backoff retries on 429 (2s then 8s), throws on other non-200s.
  - `greenhouseAdapter: SourceAdapter` (name `'greenhouse'`)
  - `seedCompanies(db: Client, csvPath: string): Promise<number>` — CSV lines `ats,slug,name`, header row required, upserts.

- [ ] **Step 1: Write the failing tests**

`packages/hunter/test/net.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { makeThrottledFetch } from '../src/net.js'

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as Response

describe('makeThrottledFetch', () => {
  it('spaces requests to the same host by minIntervalMs', async () => {
    const sleeps: number[] = []
    const f = makeThrottledFetch({
      minIntervalMs: 1000,
      sleep: async (ms) => { sleeps.push(ms) },
      fetchImpl: (() => Promise.resolve(okResponse({ a: 1 }))) as typeof fetch,
    })
    await f('https://api.example.com/one')
    await f('https://api.example.com/two')
    await f('https://other.example.org/three')
    expect(sleeps.length).toBe(1)
    expect(sleeps[0]).toBeGreaterThan(0)
    expect(sleeps[0]).toBeLessThanOrEqual(1000)
  })

  it('retries on 429 with backoff then succeeds', async () => {
    let calls = 0
    const sleeps: number[] = []
    const f = makeThrottledFetch({
      minIntervalMs: 0,
      sleep: async (ms) => { sleeps.push(ms) },
      fetchImpl: (() => {
        calls++
        return Promise.resolve(calls < 3 ? ({ ok: false, status: 429 } as Response) : okResponse({ done: true }))
      }) as typeof fetch,
    })
    expect(await f('https://api.example.com/x')).toEqual({ done: true })
    expect(sleeps).toEqual([2000, 8000])
  })

  it('throws on non-200 non-429', async () => {
    const f = makeThrottledFetch({
      minIntervalMs: 0,
      sleep: async () => {},
      fetchImpl: (() => Promise.resolve({ ok: false, status: 404 } as Response)) as typeof fetch,
    })
    await expect(f('https://api.example.com/x')).rejects.toThrow('404')
  })
})
```

`packages/hunter/test/fixtures/greenhouse-jobs.json` (trimmed real shape of `GET /v1/boards/{token}/jobs?content=true`):

```json
{
  "jobs": [
    {
      "id": 4011002,
      "title": "Senior Flutter Engineer",
      "updated_at": "2026-08-01T12:00:00-04:00",
      "location": { "name": "Remote" },
      "absolute_url": "https://boards.greenhouse.io/acme/jobs/4011002",
      "content": "&lt;p&gt;Build our mobile app with &lt;strong&gt;Flutter&lt;/strong&gt;.&lt;/p&gt;"
    },
    {
      "id": 4011003,
      "title": "Staff Accountant",
      "updated_at": "2026-08-02T12:00:00-04:00",
      "location": { "name": "New York, NY" },
      "absolute_url": "https://boards.greenhouse.io/acme/jobs/4011003",
      "content": "&lt;p&gt;Numbers.&lt;/p&gt;"
    }
  ]
}
```

`packages/hunter/test/greenhouse.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, configSchema } from '@jobhunter/core'
import { greenhouseAdapter } from '../src/sources/greenhouse.js'

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'greenhouse-jobs.json'), 'utf8'),
)
const config = configSchema.parse({ lanes: [{ id: 'x', titlePatterns: ['a'], rule: 'any' }] })

describe('greenhouseAdapter', () => {
  it('fetches jobs for every seeded greenhouse company and maps fields', async () => {
    const db = await openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))
    await db.execute("INSERT INTO companies(ats, slug, name) VALUES ('greenhouse','acme','Acme'), ('lever','other','Other')")
    const urls: string[] = []
    const jobs = await greenhouseAdapter.fetchJobs({
      db, config,
      fetchJson: async (url) => { urls.push(url); return fixture },
    })
    expect(urls).toEqual(['https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true'])
    expect(jobs).toHaveLength(2)
    expect(jobs[0]).toMatchObject({
      externalId: '4011002',
      title: 'Senior Flutter Engineer',
      company: 'Acme',
      location: 'Remote',
      applyUrl: 'https://boards.greenhouse.io/acme/jobs/4011002',
      source: 'greenhouse',
      atsFamily: 'greenhouse',
    })
    expect(jobs[0].description).toContain('<p>Build our mobile app')
  })

  it('continues past a failing company', async () => {
    const db = await openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))
    await db.execute("INSERT INTO companies(ats, slug) VALUES ('greenhouse','dead'), ('greenhouse','acme')")
    const jobs = await greenhouseAdapter.fetchJobs({
      db, config,
      fetchJson: async (url) => {
        if (url.includes('dead')) throw new Error('404')
        return fixture
      },
    })
    expect(jobs).toHaveLength(2)
  })
})
```

Note: Greenhouse escapes HTML entities in `content`; the adapter decodes entities only (so `ingestJobs`' `stripHtml` still sees tags to strip). The assertion above checks for the decoded `<p>` tag.

`packages/hunter/test/seed.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '@jobhunter/core'
import { seedCompanies } from '../src/seed.js'

describe('seedCompanies', () => {
  it('imports rows and upserts on repeat', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jh-'))
    const db = await openDb('file:' + join(dir, 't.db'))
    const csv = join(dir, 'seed.csv')
    writeFileSync(csv, 'ats,slug,name\ngreenhouse,stripe,Stripe\ngreenhouse,figma,Figma\n')
    expect(await seedCompanies(db, csv)).toBe(2)
    expect(await seedCompanies(db, csv)).toBe(2)
    const rs = await db.execute('SELECT COUNT(*) AS n FROM companies')
    expect(rs.rows[0].n).toBe(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — three unresolved imports

- [ ] **Step 3: Implement**

`packages/hunter/src/sources/types.ts`:

```ts
import type { Client } from '@libsql/client'
import type { Config } from '@jobhunter/core'
import type { RawJob } from '../types.js'

export type AdapterCtx = {
  db: Client
  config: Config
  fetchJson(url: string): Promise<unknown>
}

export type SourceAdapter = {
  name: string
  fetchJobs(ctx: AdapterCtx): Promise<RawJob[]>
}
```

`packages/hunter/src/net.ts`:

```ts
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export function makeThrottledFetch(opts?: {
  minIntervalMs?: number
  sleep?: (ms: number) => Promise<void>
  fetchImpl?: typeof fetch
}) {
  const minInterval = opts?.minIntervalMs ?? 1000
  const sleep = opts?.sleep ?? realSleep
  const fetchImpl = opts?.fetchImpl ?? fetch
  const lastCall = new Map<string, number>()

  return async function fetchJson(url: string): Promise<unknown> {
    const host = new URL(url).hostname
    const wait = (lastCall.get(host) ?? 0) + minInterval - Date.now()
    if (wait > 0) await sleep(wait)
    lastCall.set(host, Date.now())

    for (const backoff of [2000, 8000, null]) {
      const res = await fetchImpl(url, { headers: { accept: 'application/json' } })
      if (res.ok) return res.json()
      if (res.status === 429 && backoff !== null) {
        await sleep(backoff)
        continue
      }
      throw new Error(`GET ${url} failed: ${res.status}`)
    }
    throw new Error(`GET ${url} failed: unreachable`)
  }
}
```

`packages/hunter/src/sources/greenhouse.ts`:

```ts
import type { RawJob } from '../types.js'
import type { AdapterCtx, SourceAdapter } from './types.js'

const decodeEntities = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")

type GhJob = {
  id: number
  title: string
  updated_at?: string
  location?: { name?: string }
  absolute_url: string
  content?: string
}

export const greenhouseAdapter: SourceAdapter = {
  name: 'greenhouse',
  async fetchJobs(ctx: AdapterCtx): Promise<RawJob[]> {
    const rs = await ctx.db.execute("SELECT slug, name FROM companies WHERE ats='greenhouse'")
    const jobs: RawJob[] = []
    for (const row of rs.rows) {
      const slug = row.slug as string
      try {
        const data = (await ctx.fetchJson(
          `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
        )) as { jobs: GhJob[] }
        for (const j of data.jobs) {
          jobs.push({
            externalId: String(j.id),
            title: j.title,
            company: (row.name as string | null) ?? slug,
            location: j.location?.name,
            remote: /remote/i.test(j.location?.name ?? ''),
            description: decodeEntities(j.content ?? ''),
            applyUrl: j.absolute_url,
            source: 'greenhouse',
            atsFamily: 'greenhouse',
            postedAt: j.updated_at,
          })
        }
        await ctx.db.execute({
          sql: "UPDATE companies SET last_seen=datetime('now') WHERE ats='greenhouse' AND slug=?",
          args: [slug],
        })
      } catch {
        continue
      }
    }
    return jobs
  },
}
```

`packages/hunter/src/seed.ts`:

```ts
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
```

`data/companies-seed.csv` (starter set — real public Greenhouse boards; the full 20k import is Plan 5):

```csv
ats,slug,name
greenhouse,stripe,Stripe
greenhouse,cloudflare,Cloudflare
greenhouse,figma,Figma
greenhouse,reddit,Reddit
greenhouse,coinbase,Coinbase
greenhouse,gitlab,GitLab
greenhouse,dropbox,Dropbox
greenhouse,duolingo,Duolingo
greenhouse,twilio,Twilio
greenhouse,brex,Brex
```

Add to `packages/hunter/src/index.ts`:

```ts
export * from './sources/types.js'
export * from './sources/greenhouse.js'
export * from './net.js'
export * from './seed.js'
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/hunter data
git commit -m "Add throttled fetch, Greenhouse adapter, and company seeding"
```

---

### Task 8: Remotive adapter

**Files:**
- Create: `packages/hunter/src/sources/remotive.ts`
- Modify: `packages/hunter/src/index.ts` (add `export * from './sources/remotive.js'`)
- Test: `packages/hunter/test/remotive.test.ts`, `packages/hunter/test/fixtures/remotive-jobs.json`

**Interfaces:**
- Consumes: `AdapterCtx`, `SourceAdapter`, `RawJob`.
- Produces: `remotiveAdapter: SourceAdapter` (name `'remotive'`). Single GET, no company index involved.

- [ ] **Step 1: Write the failing test**

`packages/hunter/test/fixtures/remotive-jobs.json` (trimmed real shape of `GET https://remotive.com/api/remote-jobs?category=software-dev`):

```json
{
  "jobs": [
    {
      "id": 1917774,
      "url": "https://remotive.com/remote-jobs/software-dev/senior-mobile-engineer-1917774",
      "title": "Senior Mobile Engineer",
      "company_name": "Acme Remote",
      "candidate_required_location": "Worldwide",
      "salary": "$120k-$150k",
      "publication_date": "2026-08-05T09:22:41",
      "description": "<p>Flutter role, worldwide.</p>"
    }
  ]
}
```

`packages/hunter/test/remotive.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, configSchema } from '@jobhunter/core'
import { remotiveAdapter } from '../src/sources/remotive.js'

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'remotive-jobs.json'), 'utf8'),
)
const config = configSchema.parse({ lanes: [{ id: 'x', titlePatterns: ['a'], rule: 'any' }] })

describe('remotiveAdapter', () => {
  it('maps the software-dev feed to RawJobs', async () => {
    const db = await openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))
    const urls: string[] = []
    const jobs = await remotiveAdapter.fetchJobs({
      db, config,
      fetchJson: async (url) => { urls.push(url); return fixture },
    })
    expect(urls).toEqual(['https://remotive.com/api/remote-jobs?category=software-dev'])
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      externalId: '1917774',
      title: 'Senior Mobile Engineer',
      company: 'Acme Remote',
      location: 'Worldwide',
      remote: true,
      salary: '$120k-$150k',
      source: 'remotive',
      applyUrl: 'https://remotive.com/remote-jobs/software-dev/senior-mobile-engineer-1917774',
    })
    expect(jobs[0].atsFamily).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — cannot resolve `../src/sources/remotive.js`

- [ ] **Step 3: Implement**

`packages/hunter/src/sources/remotive.ts`:

```ts
import type { RawJob } from '../types.js'
import type { AdapterCtx, SourceAdapter } from './types.js'

type RemotiveJob = {
  id: number
  url: string
  title: string
  company_name: string
  candidate_required_location?: string
  salary?: string
  publication_date?: string
  description: string
}

export const remotiveAdapter: SourceAdapter = {
  name: 'remotive',
  async fetchJobs(ctx: AdapterCtx): Promise<RawJob[]> {
    const data = (await ctx.fetchJson(
      'https://remotive.com/api/remote-jobs?category=software-dev',
    )) as { jobs: RemotiveJob[] }
    return data.jobs.map((j) => ({
      externalId: String(j.id),
      title: j.title,
      company: j.company_name,
      location: j.candidate_required_location,
      remote: true,
      salary: j.salary || undefined,
      description: j.description,
      applyUrl: j.url,
      source: 'remotive',
      postedAt: j.publication_date,
    }))
  },
}
```

Add the export to `packages/hunter/src/index.ts`.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/hunter
git commit -m "Add Remotive adapter"
```

---

### Task 9: LLM judge stage

**Files:**
- Create: `packages/hunter/src/pipeline/judge.ts`
- Modify: `packages/hunter/src/index.ts` (add `export * from './pipeline/judge.js'`)
- Test: `packages/hunter/test/judge.test.ts`

**Interfaces:**
- Consumes: `Profile`, `Config`, `InvokeClaude` (injected), jobs table.
- Produces:
  - `scoreSchema` (zod): `{ score: 1..10 int; matched_strengths: { claim: string; evidence: string }[]; gaps: string[]; verdict: string }`
  - `runJudge(db: Client, config: Config, profile: Profile, invoke: InvokeClaude, now: string): Promise<{ scored: number; queued: number; failed: number }>` — takes `matched` jobs newest-first (`posted_at` desc, nulls last, then `first_seen` desc), max `scoreCapPerHunt`. Each becomes `scored` (score + score_json stored); score ≥ `queueThreshold` promotes to `queued` unless the company has a job with `submitted_at` within `companyCooldownDays`; invocation failure sets `score_failed`.

- [ ] **Step 1: Write the failing test**

`packages/hunter/test/judge.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, configSchema, type InvokeClaude } from '@jobhunter/core'
import { runJudge } from '../src/pipeline/judge.js'
import type { Profile } from '../src/profile.js'

const NOW = '2026-08-11T09:00:00Z'
const config = configSchema.parse({
  scoreCapPerHunt: 2,
  lanes: [{ id: 'x', titlePatterns: ['a'], rule: 'any' }],
})
const profile: Profile = {
  name: 'J', email: 'j@x.com', location: 'Lagos', links: [], skills: ['Flutter'],
  experience: [], education: [], screening: {},
}

async function seedJob(db: Awaited<ReturnType<typeof openDb>>, key: string, company: string, postedAt: string, status = 'matched', submittedAt?: string) {
  await db.execute({
    sql: `INSERT INTO jobs(external_key, title, company, description, apply_url, source, first_seen, posted_at, status, lane, submitted_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    args: [key, 'Senior Flutter Engineer', company, 'desc', 'url', 's', NOW, postedAt, status, 'x', submittedAt ?? null],
  })
}

const invokeWith = (score: number | Error): InvokeClaude =>
  (async () => {
    if (score instanceof Error) throw score
    return { score, matched_strengths: [{ claim: 'Flutter', evidence: 'skills' }], gaps: [], verdict: 'good fit' }
  }) as InvokeClaude

const tmpDb = () => openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))

describe('runJudge', () => {
  it('scores matched jobs and queues those at or above threshold', async () => {
    const db = await tmpDb()
    await seedJob(db, 'a:1', 'A', '2026-08-10')
    const res = await runJudge(db, config, profile, invokeWith(8), NOW)
    expect(res).toEqual({ scored: 1, queued: 1, failed: 0 })
    const rs = await db.execute("SELECT status, score, score_json FROM jobs WHERE external_key='a:1'")
    expect(rs.rows[0].status).toBe('queued')
    expect(rs.rows[0].score).toBe(8)
    expect(JSON.parse(rs.rows[0].score_json as string).verdict).toBe('good fit')
  })

  it('leaves sub-threshold jobs at scored', async () => {
    const db = await tmpDb()
    await seedJob(db, 'a:1', 'A', '2026-08-10')
    await runJudge(db, config, profile, invokeWith(5), NOW)
    const rs = await db.execute("SELECT status FROM jobs WHERE external_key='a:1'")
    expect(rs.rows[0].status).toBe('scored')
  })

  it('respects scoreCapPerHunt, newest first', async () => {
    const db = await tmpDb()
    await seedJob(db, 'a:1', 'A', '2026-08-01')
    await seedJob(db, 'a:2', 'B', '2026-08-09')
    await seedJob(db, 'a:3', 'C', '2026-08-10')
    const res = await runJudge(db, config, profile, invokeWith(5), NOW)
    expect(res.scored).toBe(2)
    const rs = await db.execute("SELECT status FROM jobs WHERE external_key='a:1'")
    expect(rs.rows[0].status).toBe('matched')
  })

  it('does not queue a company inside the cooldown window', async () => {
    const db = await tmpDb()
    await seedJob(db, 'a:0', 'A', '2026-08-01', 'submitted', '2026-08-05T00:00:00Z')
    await seedJob(db, 'a:1', 'A', '2026-08-10')
    const res = await runJudge(db, config, profile, invokeWith(9), NOW)
    expect(res.queued).toBe(0)
    const rs = await db.execute("SELECT status FROM jobs WHERE external_key='a:1'")
    expect(rs.rows[0].status).toBe('scored')
  })

  it('marks jobs score_failed when invocation fails', async () => {
    const db = await tmpDb()
    await seedJob(db, 'a:1', 'A', '2026-08-10')
    const res = await runJudge(db, config, profile, invokeWith(new Error('quota')), NOW)
    expect(res).toEqual({ scored: 0, queued: 0, failed: 1 })
    const rs = await db.execute("SELECT status FROM jobs WHERE external_key='a:1'")
    expect(rs.rows[0].status).toBe('score_failed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — cannot resolve `../src/pipeline/judge.js`

- [ ] **Step 3: Implement**

`packages/hunter/src/pipeline/judge.ts`:

```ts
import type { Client } from '@libsql/client'
import { z } from 'zod'
import type { Config, InvokeClaude } from '@jobhunter/core'
import type { Profile } from '../profile.js'

export const scoreSchema = z.object({
  score: z.number().int().min(1).max(10),
  matched_strengths: z.array(z.object({ claim: z.string(), evidence: z.string() })),
  gaps: z.array(z.string()),
  verdict: z.string(),
})

const RUBRIC = `Score how well this candidate fits this job, 1-10:
9-10: meets every stated must-have with direct evidence from the profile; role is squarely in the candidate's core stack and seniority.
7-8: meets all must-haves; at most minor stretch on nice-to-haves.
5-6: meets most must-haves but has one real gap (a required technology, domain, or years-of-experience shortfall).
3-4: multiple must-have gaps.
1-2: wrong role, stack, or seniority entirely.
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
    } catch {
      failed++
      await db.execute({ sql: "UPDATE jobs SET status='score_failed' WHERE id=?", args: [row.id] })
    }
  }
  return { scored, queued, failed }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/hunter
git commit -m "Add LLM judge stage with cooldown and score cap"
```

---

### Task 10: Hunt orchestrator + CLI

**Files:**
- Create: `packages/hunter/src/hunt.ts`, `packages/hunter/src/cli.ts`
- Modify: `packages/hunter/src/index.ts` (add `export * from './hunt.js'`)
- Test: `packages/hunter/test/hunt.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `hunt(deps: { db: Client; config: Config; adapters: SourceAdapter[]; invoke: InvokeClaude; fetchJson: (url: string) => Promise<unknown>; now: string }): Promise<{ runs: { source: string; ok: boolean; jobsFound: number }[]; filter: { matched: number; filteredOut: number }; judge: { scored: number; queued: number; failed: number } | null }>` — judge is skipped (null) when no profile exists.
  - CLI commands: `jobhunter hunt`, `jobhunter parse-resume <pdf>`, `jobhunter seed-companies <csv>`, `jobhunter queue` (queue listing implemented in Task 11; the CLI stub for it lands here).

- [ ] **Step 1: Write the failing test**

`packages/hunter/test/hunt.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, configSchema, type InvokeClaude } from '@jobhunter/core'
import { hunt } from '../src/hunt.js'
import type { SourceAdapter } from '../src/sources/types.js'

const NOW = '2026-08-11T09:00:00Z'
const config = configSchema.parse({
  lanes: [{ id: 'remote-mobile', titlePatterns: ['flutter'], rule: 'remote' }],
})

const goodAdapter: SourceAdapter = {
  name: 'good',
  fetchJobs: async () => [
    { externalId: '1', title: 'Senior Flutter Engineer', company: 'A', description: 'Anywhere', applyUrl: 'u', source: 'good', remote: true, location: 'Remote' },
  ],
}
const badAdapter: SourceAdapter = {
  name: 'bad',
  fetchJobs: async () => { throw new Error('API changed') },
}
const invoke = (async () => ({
  score: 8, matched_strengths: [{ claim: 'c', evidence: 'e' }], gaps: [], verdict: 'v',
})) as InvokeClaude

describe('hunt', () => {
  it('runs adapters in isolation, records runs, filters, and judges', async () => {
    const db = await openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))
    await db.execute({
      sql: "INSERT INTO profile(id, json, updated_at) VALUES (1, ?, ?)",
      args: [JSON.stringify({ name: 'J', email: 'j@x.com', location: 'Lagos', links: [], skills: [], experience: [], education: [], screening: {} }), NOW],
    })
    const result = await hunt({ db, config, adapters: [goodAdapter, badAdapter], invoke, fetchJson: async () => ({}), now: NOW })

    expect(result.runs).toEqual([
      { source: 'good', ok: true, jobsFound: 1 },
      { source: 'bad', ok: false, jobsFound: 0 },
    ])
    expect(result.filter).toEqual({ matched: 1, filteredOut: 0 })
    expect(result.judge).toEqual({ scored: 1, queued: 1, failed: 0 })

    const runs = await db.execute('SELECT source, ok, error FROM runs ORDER BY id')
    expect(runs.rows[0].ok).toBe(1)
    expect(runs.rows[1].ok).toBe(0)
    expect(runs.rows[1].error).toContain('API changed')
  })

  it('skips the judge when no profile exists', async () => {
    const db = await openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))
    const result = await hunt({ db, config, adapters: [goodAdapter], invoke, fetchJson: async () => ({}), now: NOW })
    expect(result.judge).toBeNull()
    const rs = await db.execute('SELECT status FROM jobs')
    expect(rs.rows[0].status).toBe('matched')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — cannot resolve `../src/hunt.js`

- [ ] **Step 3: Implement**

`packages/hunter/src/hunt.ts`:

```ts
import type { Client } from '@libsql/client'
import type { Config, InvokeClaude } from '@jobhunter/core'
import type { SourceAdapter } from './sources/types.js'
import { ingestJobs } from './pipeline/ingest.js'
import { runFilter } from './pipeline/filter.js'
import { runJudge } from './pipeline/judge.js'
import { getProfile } from './profile.js'

export async function hunt(deps: {
  db: Client
  config: Config
  adapters: SourceAdapter[]
  invoke: InvokeClaude
  fetchJson: (url: string) => Promise<unknown>
  now: string
}) {
  const { db, config, adapters, invoke, fetchJson, now } = deps
  const runs: { source: string; ok: boolean; jobsFound: number }[] = []

  for (const adapter of adapters) {
    const ins = await db.execute({
      sql: 'INSERT INTO runs(started_at, source) VALUES (?, ?) RETURNING id',
      args: [now, adapter.name],
    })
    const runId = ins.rows[0].id
    try {
      const raws = await adapter.fetchJobs({ db, config, fetchJson })
      await ingestJobs(db, raws, now)
      await db.execute({
        sql: "UPDATE runs SET finished_at=datetime('now'), ok=1, jobs_found=? WHERE id=?",
        args: [raws.length, runId],
      })
      runs.push({ source: adapter.name, ok: true, jobsFound: raws.length })
    } catch (err) {
      await db.execute({
        sql: "UPDATE runs SET finished_at=datetime('now'), ok=0, error=?, jobs_found=0 WHERE id=?",
        args: [String(err), runId],
      })
      runs.push({ source: adapter.name, ok: false, jobsFound: 0 })
    }
  }

  const filter = await runFilter(db, config)
  const profile = await getProfile(db)
  const judge = profile ? await runJudge(db, config, profile, invoke, now) : null
  return { runs, filter, judge }
}
```

`packages/hunter/src/cli.ts`:

```ts
import { loadConfig, openDb, invokeClaude } from '@jobhunter/core'
import { hunt } from './hunt.js'
import { greenhouseAdapter } from './sources/greenhouse.js'
import { remotiveAdapter } from './sources/remotive.js'
import { makeThrottledFetch } from './net.js'
import { parseResume } from './profile.js'
import { seedCompanies } from './seed.js'
import { listQueue } from './queue.js'

const [command, arg] = process.argv.slice(2)

const config = loadConfig()
const db = await openDb(config.dbUrl, config.dbAuthToken)

switch (command) {
  case 'hunt': {
    const result = await hunt({
      db,
      config,
      adapters: [greenhouseAdapter, remotiveAdapter],
      invoke: invokeClaude,
      fetchJson: makeThrottledFetch(),
      now: new Date().toISOString(),
    })
    for (const r of result.runs) console.log(`${r.ok ? 'ok ' : 'ERR'} ${r.source}: ${r.jobsFound} jobs`)
    console.log(`filter: ${result.filter.matched} matched, ${result.filter.filteredOut} out`)
    console.log(result.judge ? `judge: ${result.judge.scored} scored, ${result.judge.queued} queued, ${result.judge.failed} failed` : 'judge skipped: run parse-resume first')
    break
  }
  case 'parse-resume': {
    if (!arg) throw new Error('usage: jobhunter parse-resume <pdf-path>')
    const profile = await parseResume(db, arg, config, invokeClaude)
    console.log(`profile stored for ${profile.name} (${profile.skills.length} skills, ${profile.experience.length} roles)`)
    break
  }
  case 'seed-companies': {
    if (!arg) throw new Error('usage: jobhunter seed-companies <csv-path>')
    console.log(`seeded ${await seedCompanies(db, arg)} companies`)
    break
  }
  case 'queue': {
    for (const line of await listQueue(db)) console.log(line)
    break
  }
  default:
    console.log('usage: jobhunter <hunt|parse-resume|seed-companies|queue>')
}
```

Note: `listQueue` does not exist yet — create a placeholder `packages/hunter/src/queue.ts` exporting `export async function listQueue(): Promise<string[]> { return [] }` so the CLI compiles; Task 11 replaces it TDD-style. The placeholder takes no DB yet; Task 11 fixes the signature.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/hunter
git commit -m "Add hunt orchestrator and CLI entry"
```

---

### Task 11: Queue listing

**Files:**
- Create (replace placeholder): `packages/hunter/src/queue.ts`
- Modify: `packages/hunter/src/index.ts` (add `export * from './queue.js'`), `packages/hunter/src/cli.ts` (pass `db` to `listQueue`)
- Test: `packages/hunter/test/queue.test.ts`

**Interfaces:**
- Consumes: jobs table.
- Produces: `listQueue(db: Client): Promise<string[]>` — one formatted line per `queued` job, highest score first: `[8/10] Senior Flutter Engineer — Acme (remote-mobile) https://...`.

- [ ] **Step 1: Write the failing test**

`packages/hunter/test/queue.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '@jobhunter/core'
import { listQueue } from '../src/queue.js'

describe('listQueue', () => {
  it('lists queued jobs highest score first', async () => {
    const db = await openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))
    const insert = (key: string, title: string, score: number, status: string) =>
      db.execute({
        sql: `INSERT INTO jobs(external_key, title, company, description, apply_url, source, first_seen, status, score, lane)
              VALUES (?,?,?,?,?,?,?,?,?,?)`,
        args: [key, title, 'Acme', 'd', `https://x/${key}`, 's', '2026-08-11', status, score, 'remote-mobile'],
      })
    await insert('a:1', 'Senior Flutter Engineer', 8, 'queued')
    await insert('a:2', 'Senior Mobile Engineer', 9, 'queued')
    await insert('a:3', 'Senior React Engineer', 9, 'scored')

    const lines = await listQueue(db)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('[9/10] Senior Mobile Engineer — Acme (remote-mobile) https://x/a:2')
    expect(lines[1]).toBe('[8/10] Senior Flutter Engineer — Acme (remote-mobile) https://x/a:1')
  })

  it('returns an empty list when nothing is queued', async () => {
    const db = await openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))
    expect(await listQueue(db)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — placeholder signature/behavior mismatch

- [ ] **Step 3: Implement**

`packages/hunter/src/queue.ts`:

```ts
import type { Client } from '@libsql/client'

export async function listQueue(db: Client): Promise<string[]> {
  const rs = await db.execute(
    "SELECT score, title, company, lane, apply_url FROM jobs WHERE status='queued' ORDER BY score DESC, first_seen DESC",
  )
  return rs.rows.map(
    (r) => `[${r.score}/10] ${r.title} — ${r.company} (${r.lane}) ${r.apply_url}`,
  )
}
```

Update the `queue` case in `cli.ts` to `await listQueue(db)` (it already passes `db` if written as in Task 10 — verify the call is `listQueue(db)`).

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test`
Expected: PASS (full suite green)

- [ ] **Step 5: Commit, then live smoke test**

```bash
git add packages/hunter
git commit -m "Add queue listing"
```

Live smoke (manual, requires network + logged-in `claude` CLI):

```bash
pnpm jobhunter seed-companies data/companies-seed.csv
pnpm jobhunter parse-resume ~/Downloads/"Jeremiah Ekanem - Senior Software Engineer.pdf"
pnpm jobhunter hunt
pnpm jobhunter queue
```

Expected: seed reports 10 companies; parse-resume prints the profile summary; hunt reports per-source counts and judge results; queue prints scored roles. This validates the real Greenhouse/Remotive endpoints and the real `claude` binary end to end.

---

## Verification checklist (run after all tasks)

- `pnpm test` — entire suite green.
- `git log --oneline` — one commit per task, no attribution trailers.
- Live smoke test from Task 11 Step 5 executed and sane.
- Spec cross-check: sourcing (2 of 13 adapters — rest in Plan 5), normalize/dedupe ✓, rules filter with all four lanes ✓, judge with cap/threshold/cooldown ✓, run recording with per-adapter isolation ✓, profile parse ✓, statuses match spec ✓. Drafter/fact-lock/style-lint are Plan 2; dashboard Plan 3; applier Plan 4; politeness backoff ✓ (throttle + 429 handling).
