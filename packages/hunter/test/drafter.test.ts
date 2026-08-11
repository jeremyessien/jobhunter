import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, configSchema, type InvokeClaude } from '@jobhunter/core'
import { runDrafter, PREDICTED_QUESTIONS, type Draft } from '../src/pipeline/drafter.js'
import type { Profile } from '../src/profile.js'

const config = configSchema.parse({
  draftCapPerHunt: 2,
  lanes: [{ id: 'x', titlePatterns: ['a'], rule: 'any' }],
})

const profile: Profile = {
  name: 'Jeremiah Ekanem',
  email: 'j@x.com',
  location: 'Lagos, Nigeria',
  links: [],
  skills: ['Flutter', 'Dart'],
  experience: [
    { company: 'Heirs', title: 'Senior Flutter Engineer', start: '2026-02', end: null, highlights: ['Cold start 11.4s to 2.1s', '195 tests'] },
  ],
  education: [],
  screening: { noticePeriod: '30 days' },
}

const cleanDraft: Draft = {
  cover_letter: "I rebuilt a bank's Flutter cold start from 11.4s to 2.1s. Your posting reads like the same class of problem, and I want to work on it.",
  answers: [{ question: 'What is your notice period?', answer: 'My notice period is 30 days.' }],
}
const styleViolatingDraft: Draft = {
  cover_letter: 'I am thrilled to leverage my skills — truly.',
  answers: [],
}
const fabricatingDraft: Draft = {
  cover_letter: 'I improved performance by 82% across 12 apps.',
  answers: [],
}

const tmpDb = () => openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))

async function seedQueued(db: Awaited<ReturnType<typeof openDb>>, key: string, score: number, over: Record<string, unknown> = {}) {
  await db.execute({
    sql: `INSERT INTO jobs(external_key, title, company, description, apply_url, source, first_seen, status, score, lane)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
    args: [
      key,
      (over.title as string) ?? 'Senior Flutter Engineer',
      (over.company as string) ?? 'Acme',
      (over.description as string) ?? 'Build Flutter apps.',
      (over.apply_url as string) ?? `https://example.com/${key}`,
      (over.source as string) ?? 'remotive',
      '2026-08-11T09:00:00Z',
      'queued',
      score,
      'x',
    ],
  })
}

function invokeReturning(drafts: Draft[]): { invoke: InvokeClaude; prompts: string[] } {
  const prompts: string[] = []
  let call = 0
  const invoke = (async (opts: { prompt: string }) => {
    prompts.push(opts.prompt)
    const draft = drafts[Math.min(call, drafts.length - 1)]
    call++
    return draft
  }) as InvokeClaude
  return { invoke, prompts }
}

describe('runDrafter', () => {
  it('stores a clean draft and marks the job drafted', async () => {
    const db = await tmpDb()
    await seedQueued(db, 'a:1', 8)
    const { invoke, prompts } = invokeReturning([cleanDraft])
    const res = await runDrafter({ db, config, profile, invoke, fetchJson: async () => ({}) })
    expect(res).toEqual({ drafted: 1, manual: 0, deferred: 0 })
    const rs = await db.execute("SELECT cover_letter, answers_json, draft_flag FROM jobs WHERE external_key='a:1'")
    expect(rs.rows[0].draft_flag).toBe('drafted')
    expect(rs.rows[0].cover_letter).toContain('11.4s')
    expect(JSON.parse(rs.rows[0].answers_json as string)).toEqual(cleanDraft.answers)
    expect(prompts[0]).toContain(PREDICTED_QUESTIONS[0])
    expect(prompts[0]).toContain('Jeremiah Ekanem')
  })

  it('regenerates once on style violations, feeding the violations back', async () => {
    const db = await tmpDb()
    await seedQueued(db, 'a:1', 8)
    const { invoke, prompts } = invokeReturning([styleViolatingDraft, cleanDraft])
    const res = await runDrafter({ db, config, profile, invoke, fetchJson: async () => ({}) })
    expect(res).toEqual({ drafted: 1, manual: 0, deferred: 0 })
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toContain('em-dash')
    expect(prompts[1]).toContain('i am thrilled')
  })

  it('flags the job manual when both attempts fail the gates', async () => {
    const db = await tmpDb()
    await seedQueued(db, 'a:1', 8)
    const { invoke, prompts } = invokeReturning([fabricatingDraft, fabricatingDraft])
    const res = await runDrafter({ db, config, profile, invoke, fetchJson: async () => ({}) })
    expect(res).toEqual({ drafted: 0, manual: 1, deferred: 0 })
    expect(prompts).toHaveLength(2)
    const rs = await db.execute("SELECT cover_letter, draft_flag FROM jobs WHERE external_key='a:1'")
    expect(rs.rows[0].draft_flag).toBe('manual')
    expect(rs.rows[0].cover_letter).toBeNull()
  })

  it('defers the job untouched when the invocation throws', async () => {
    const db = await tmpDb()
    await seedQueued(db, 'a:1', 8)
    const invoke = (async () => {
      throw new Error('quota')
    }) as InvokeClaude
    const res = await runDrafter({ db, config, profile, invoke, fetchJson: async () => ({}) })
    expect(res).toEqual({ drafted: 0, manual: 0, deferred: 1 })
    const rs = await db.execute("SELECT draft_flag FROM jobs WHERE external_key='a:1'")
    expect(rs.rows[0].draft_flag).toBeNull()
  })

  it('respects draftCapPerHunt, highest score first', async () => {
    const db = await tmpDb()
    await seedQueued(db, 'a:1', 7)
    await seedQueued(db, 'a:2', 9)
    await seedQueued(db, 'a:3', 8)
    const { invoke } = invokeReturning([cleanDraft])
    const res = await runDrafter({ db, config, profile, invoke, fetchJson: async () => ({}) })
    expect(res.drafted).toBe(2)
    const rs = await db.execute("SELECT draft_flag FROM jobs WHERE external_key='a:1'")
    expect(rs.rows[0].draft_flag).toBeNull()
  })

  it('uses real Greenhouse questions when the job came from greenhouse', async () => {
    const db = await tmpDb()
    await seedQueued(db, 'greenhouse:4011002', 8, {
      source: 'greenhouse',
      apply_url: 'https://boards.greenhouse.io/acme/jobs/4011002',
    })
    const { invoke, prompts } = invokeReturning([cleanDraft])
    await runDrafter({
      db, config, profile, invoke,
      fetchJson: async () => ({
        questions: [{ label: 'Why Acme?', fields: [{ type: 'textarea' }] }],
      }),
    })
    expect(prompts[0]).toContain('Why Acme?')
    expect(prompts[0]).not.toContain(PREDICTED_QUESTIONS[0])
  })
})
