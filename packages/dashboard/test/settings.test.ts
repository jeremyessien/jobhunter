import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '@jobhunter/core'
import { getProfile } from '@jobhunter/hunter'
import { updateScreening, updateVoice, validateConfigText } from '../lib/settings.js'

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

describe('updateVoice', () => {
  it('stores a writing sample and notes without touching the rest of the profile', async () => {
    const db = await tmpDb()
    await seedProfile(db)
    const updated = await updateVoice(db, {
      voiceSample: 'We shipped the offline sync in a week.',
      voiceNotes: 'no throat clearing',
    })
    expect(updated.voiceSample).toBe('We shipped the offline sync in a week.')
    expect(updated.voiceNotes).toBe('no throat clearing')
    expect(updated.screening.noticePeriod).toBe('30 days')
    expect(updated.skills).toEqual(['Flutter'])
    const roundTrip = await getProfile(db)
    expect(roundTrip?.voiceSample).toBe('We shipped the offline sync in a week.')
  })

  it('clears the sample when handed undefined', async () => {
    const db = await tmpDb()
    await seedProfile(db)
    await updateVoice(db, { voiceSample: 'first pass' })
    const cleared = await updateVoice(db, { voiceSample: undefined })
    expect(cleared.voiceSample).toBeUndefined()
  })

  it('throws when no profile is stored', async () => {
    const db = await tmpDb()
    await expect(updateVoice(db, { voiceSample: 'x' })).rejects.toThrow('no profile stored')
  })
})
