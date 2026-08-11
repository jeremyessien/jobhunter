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
