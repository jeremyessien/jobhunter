# Jobhunter — Design Spec

*2026-08-11 · working name "jobhunter", rename freely*

## What this is

A personal job-hunting agent for Jeremiah. He uploads his resume once; on a schedule it sources roles from free job APIs, scores his fit with an LLM judge, drafts tailored application materials, and queues everything in a dashboard he can open from any device. Approving a job triggers an assisted-apply session on his Mac: Playwright fills the entire application form in a visible browser and stops at the submit button for his click.

Runs at strictly $0 beyond what he already pays (Claude subscription).

## Requirements

- **Audience:** single user, personal tool. No multi-tenancy, no billing, no public product concerns.
- **Cost:** $0 extra. Free-tier services only; all LLM work rides the existing Claude Code subscription (headless `claude -p` locally, `claude setup-token` OAuth token in CI).
- **Search lanes (all four):**
  1. Remote-worldwide senior Flutter/mobile
  2. Senior frontend/full-stack (React/Next.js)
  3. On-site roles with visa sponsorship — anywhere in the world
  4. Nigeria/Africa local market
- **Automation level:** assisted apply — the tool does everything except the final submit click. No unattended submission in v1 (see Research constraints).
- **Deployment:** cloud-split from day one. Hunts and dashboard work with the Mac closed; only the apply step requires the Mac.

## Research constraints (what shaped this design)

Three research passes (job sources, auto-apply feasibility, resume matching) established:

1. **Sourcing at $0 is solved.** Greenhouse, Lever, Ashby, Workable, SmartRecruiters, and Recruitee expose free, keyless read APIs (full descriptions; Greenhouse includes per-job application-question schemas; Ashby includes compensation). Free aggregators cover the remote/visa/Nigeria lanes (see Appendix A). No ATS publishes a customer directory — a company-slug index must be built from open-source seed lists and HN thread harvesting.
2. **Universal auto-submit is not possible cleanly.** ATS write-endpoints require the target company's own API key. Browser-automated unattended submission hits invisible reCAPTCHA Enterprise (Greenhouse), Cloudflare Turnstile, and Workday per-employer account walls. LinkedIn Easy Apply bots are detected within hours; account bans are common (~23% reported by automation vendors). **Hard rule: never automate against Jeremiah's LinkedIn account; never attempt keyless POSTs to third-party ATS boards.**
3. **Review-and-tailor beats volume.** Fully-automated spray tools see ~1–6% callback rates; human-reviewed tailored applications see ~5–15%. Recruiter-side AI-spam filters flag high-velocity identical applications. The assisted-apply model (fill everything, human clicks submit) is the sustainable pattern — it is Simplify's model, the most trusted tool in the space.
4. **LLM extraction beats parser libraries.** Claude reading the resume PDF directly achieves ~0.92–0.96 F1 on field extraction; classic parsers (pyresparser etc.) are dead. Real ATS auto-rejection comes from knockout questions, not resume keywords — so drafting screening-question answers carefully is where LLM effort pays.

## Architecture

Three components, one shared database. TypeScript end-to-end (Node 22).

```
                      ┌─────────────────────────┐
   GitHub Actions ──▶ │  hunter (CLI)           │
   (cron 2×/day)      │  source → normalize →   │
                      │  dedupe → filter →      │──┐
                      │  judge → draft          │  │
                      └─────────────────────────┘  ▼
                                          ┌──────────────┐
                                          │ Turso (libSQL)│  free tier
                                          └──────────────┘
                                             ▲         ▲
                      ┌──────────────────────┘         │
                      ▼                                │
      ┌─────────────────────────┐      ┌───────────────────────────┐
      │ dashboard (Next.js)     │      │ applier (CLI, Mac only)   │
      │ Vercel Hobby, Google    │      │ Playwright, headed browser │
      │ login, phone-friendly   │      │ fills form, pauses at     │
      └─────────────────────────┘      │ submit for human click    │
                                       └───────────────────────────┘
```

- **Database:** libSQL client against Turso's free hosted tier (9 GB). The same client speaks to a local SQLite file, so "fully local mode" is a config flag, not a migration.
- **Hunter:** plain CLI (`jobhunter hunt`) so it runs identically under GitHub Actions (private repo, 2,000 free min/month; hunts 2×/day fit) or `launchd` locally. Claude access in CI via a `claude setup-token` OAuth token stored as an Actions secret.
- **Dashboard:** Next.js on Vercel Hobby (personal use). Auth: single-user Google sign-in; every route gated.
- **Applier:** local-only CLI/daemon. Polls for `approved` jobs when running; approvals made from the phone queue until the Mac picks them up. Away-from-Mac fallback: dashboard exposes the apply URL plus all drafted answers for manual copy-paste.

### Monorepo layout

```
jobhunter/
  packages/core/        shared types, db schema + migrations, config loader
  packages/hunter/      source adapters, normalize, dedupe, filter, judge, drafter
  packages/applier/     Playwright autofill engine (per-ATS strategies)
  packages/dashboard/   Next.js app
```

## Components

### Resume profile (one-time + occasional edits)
Claude reads the resume PDF directly (document block) into a structured profile JSON: contact, skills, experience with verified stats, education, work-authorization facts, standard screening answers (notice period, salary expectations, visa status per region). Stored in the DB, hand-correctable in the dashboard. This profile is the **fact source** for all generation.

### Source adapters (~13)
One interface: `fetchJobs(ctx): RawJob[]`. Each ~50 lines. Failures are isolated per adapter.

- **ATS family** (driven by the company index): Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee.
- **Remote boards:** Himalayas (timezone/geo-eligibility filters), Remotive, RemoteOK, WeWorkRemotely (RSS), Arbeitnow (visa tags).
- **Nigeria:** Jooble API (free key; one of the only structured sources covering Nigeria).
- **Signal:** HN "Who is Hiring" via Algolia API, monthly; parsed with the LLM; also harvests ATS slugs for the company index.

**Company index:** table of `(ats, slug, company_name, last_seen)` seeded from open-source lists (e.g. Feashliaa/job-board-aggregator, 20k+ companies), grown from HN harvests. One GET per company per hunt, throttled.

### Normalize + dedupe
Canonical `Job` record (title, company, location, remote flags, salary if present, description, apply URL, source, ATS family, posted/updated dates). Dedupe by apply-URL and by (company, normalized title); cross-board duplicates merge, keeping the richest record (prefer direct ATS source over aggregator).

### Rules filter ($0, removes ~80%)
Config-file lanes: title/seniority patterns per lane, geo-eligibility from Lagos (UTC+1) for remote roles, optional salary floor, company blocklist, already-seen suppression. The visa lane has no geo restriction: any on-site role qualifies if sponsorship is detectable — Arbeitnow's explicit visa tags plus keyword detection ("visa sponsorship", "relocation support", "work permit assistance") in JD text across all sources.

### Judge (LLM-as-judge)
`claude -p` (Haiku-tier), anchored 1–10 rubric against the profile, strict JSON schema: `{score, matched_strengths[] (with resume evidence citations), gaps[], verdict}`. Cap: ~30 jobs scored per hunt, selected newest-first from the rules-filter survivors (recency is itself a signal — early applications get reviewed first). Coarse scale + evidence-citation requirement + schema validation mitigate known LLM-judge failure modes.

### Drafter (score ≥ 7 only)
Sonnet-tier. Produces: short tailored cover letter, answers to the job's screening questions (Greenhouse provides the real question schema via API; other ATSs get predicted-common-questions answered from profile). **Fact-lock:** a validation pass rejects any draft containing claims absent from the profile JSON; one regeneration, then the job queues draft-less flagged "write manually."

**Voice:** drafts must read like Jeremiah wrote them. Plain human language, contractions fine, no em-dashes, no emojis, no AI-sounding constructions ("I am thrilled", "delve", "leverage", marketing-style feature bullets). The drafter prompt carries a style guide distilled from Jeremiah's own writing samples; a **style-lint** pass (banned characters and phrase list) sits alongside the fact-lock as a second hard gate — a draft that fails either never reaches the queue as-is.

### Status lifecycle
`sourced → filtered_out | scored → drafted → queued → approved → submitted → responded | rejected | stale`

Doubles as the application tracker; dashboard reports response rate per lane.

### Dashboard
- **Queue:** scored jobs sorted by score; card shows score, lane, company, evidence, gaps.
- **Detail:** full JD beside drafted materials, inline-editable. Approve / Skip / Snooze.
- **Tracker:** submitted applications, response tagging, per-lane stats.
- **Health:** last hunt time, per-source status, quota warnings.
- **Settings:** lanes config, blocklist, profile editor.

### Applier
Per-ATS-family fill strategies: Greenhouse hosted form, Lever apply page, Ashby, Workable, generic fallback (fill recognized fields, visually highlight the rest). Attaches resume PDF, fills drafted answers, scrolls to submit, **stops**. Human clicks. Confirmation-page detection marks `submitted`; if undetected, dashboard asks "did this go through?". Screenshots saved per session.

### Notifier
The hunter runs in CI, so it cannot post macOS notifications itself. The applier daemon, when running on the Mac, polls for newly queued jobs and posts a local macOS notification; away from the Mac, the dashboard (opened on the phone) is the channel.

## Error handling

- **Adapter isolation:** per-adapter try/catch; failures recorded in a `runs` table; 3 consecutive failures of one source → dashboard health warning. A broken source never aborts a hunt.
- **Politeness:** per-host throttle (~1 req/s), exponential backoff on 429, conditional GETs where supported. Free endpoints get IP-blocked when hammered.
- **LLM validation:** every response schema-checked (zod); one retry with validation feedback; then `score_failed`/draft-less, never lost, never guessed. Subscription-quota exhaustion defers remaining work to the next run.
- **Fact-lock as hard gate:** unvalidated text never leaves under Jeremiah's name.
- **Applier honesty:** unknown fields highlighted not skipped; unconfirmed submissions asked about, not assumed; screenshots for every session.
- **Spam-flag protection:** per-company cooldown — never queue a second application to the same company within N days (default 14); high-velocity same-company applications are the canonical bot signature recruiters filter.

## Testing

- **Adapters:** unit tests on checked-in fixture JSON (no network). Weekly live `smoke` command reports endpoint drift as a health warning.
- **Fact-lock + style-lint validators:** pure functions; the most heavily unit-tested components (planted-fabrication cases; planted em-dashes, emojis, and banned phrases).
- **Judge/drafter:** golden tests asserting schema validity and that planted disqualifiers are caught (deterministic properties, not exact output).
- **Applier:** Playwright tests against saved HTML of real ATS forms per family; manual live run before a family strategy ships.
- **Pipeline:** integration test over fixture sources into a temp DB asserting every state transition.
- TDD throughout implementation.

## Cost model

| Item | Cost |
|---|---|
| Job source APIs | $0 (free/keyless; Jooble needs a free key) |
| Database | $0 (Turso free tier; local SQLite fallback) |
| Dashboard hosting | $0 (Vercel Hobby) |
| Hunt scheduling | $0 (GitHub Actions private-repo free minutes) |
| LLM scoring/drafting | $0 extra (Claude Code subscription; capped at ~30 scores + ~10 drafts/hunt to respect quota) |
| Applier | $0 (local Playwright) |

## Out of scope for v1 (explicitly deferred)

- **Auto-submit lane** (email applications, Recruitee-style open candidate-POST APIs) — bolt-on later behind the same queue.
- **Gray-zone sources** (JobSpy Indeed-Nigeria scraping) — revisit if the Nigeria lane proves too thin.
- **Local embeddings pre-filter** (bge-small) — only needed if LLM quota becomes a real constraint.
- **LinkedIn/Indeed anything automated** — permanent no, not deferred. Read-only links at most.

## Open items

- Project name (working: "jobhunter").
- Turso + Vercel + Jooble account/key setup (one-time, all free).
- Which seed list(s) to import for the company index (decided during implementation).

## Appendix A: Load-bearing endpoints

- Greenhouse: `GET boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true`; questions via `/jobs/{id}?questions=true`
- Lever: `GET api.lever.co/v0/postings/{company}?mode=json`
- Ashby: `GET api.ashbyhq.com/posting-api/job-board/{org}?includeCompensation=true`
- Workable: `GET apply.workable.com/api/v1/widget/accounts/{account}` (v3 endpoints richer but undocumented)
- SmartRecruiters: `GET api.smartrecruiters.com/v1/companies/{id}/postings`
- Recruitee: `GET {company}.recruitee.com/api/offers/`
- Himalayas: `GET himalayas.app/jobs/api?limit=100`
- Remotive: `GET remotive.com/api/remote-jobs?category=software-dev`
- RemoteOK: `GET remoteok.com/api`
- WWR: `weworkremotely.com/categories/remote-programming-jobs.rss`
- Arbeitnow: `GET arbeitnow.com/api/job-board-api`
- Jooble: `POST jooble.org/api/{key}`
- HN: Algolia `hn.algolia.com/api/v1/search_by_date?tags=comment,story_{id}`
