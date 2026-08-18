import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, configSchema, type InvokeClaude } from '@jobhunter/core'
import { parseResume, getProfile, profileSchema } from '../src/profile.js'

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
})

describe('voice fields', () => {
  it('leaves voice undefined when the profile has none', () => {
    const parsed = profileSchema.parse(canned)
    expect(parsed.voiceSample).toBeUndefined()
    expect(parsed.voiceNotes).toBeUndefined()
  })

  it('round-trips a stored writing sample and notes', async () => {
    const db = await tmpDb()
    const withVoice = {
      ...canned,
      voiceSample: 'We shipped the offline sync in a week. It was ugly but it held.',
      voiceNotes: 'never open with a question',
    }
    const invoke = (() => Promise.resolve(withVoice)) as unknown as InvokeClaude
    await parseResume(db, '/fake/resume.pdf', config, invoke)
    const profile = await getProfile(db)
    expect(profile?.voiceSample).toBe('We shipped the offline sync in a week. It was ugly but it held.')
    expect(profile?.voiceNotes).toBe('never open with a question')
  })
})

describe('re-parsing a resume', () => {
  it('keeps voice and screening that the resume cannot know about', async () => {
    const db = await tmpDb()
    const invoke = (() => Promise.resolve(canned)) as unknown as InvokeClaude
    await parseResume(db, '/fake/resume.pdf', config, invoke)

    await db.execute({
      sql: 'UPDATE profile SET json=? WHERE id=1',
      args: [
        JSON.stringify({
          ...canned,
          voiceSample: 'We shipped it Friday.',
          voiceNotes: 'no throat clearing',
          screening: { noticePeriod: 'Two weeks', workAuthorization: 'Nigerian citizen' },
        }),
      ],
    })

    await parseResume(db, '/fake/resume-v2.pdf', config, invoke)

    const profile = await getProfile(db)
    expect(profile?.voiceSample).toBe('We shipped it Friday.')
    expect(profile?.voiceNotes).toBe('no throat clearing')
    expect(profile?.screening.noticePeriod).toBe('Two weeks')
    expect(profile?.screening.workAuthorization).toBe('Nigerian citizen')
  })
})
