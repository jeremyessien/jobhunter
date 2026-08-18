import { describe, it, expect } from 'vitest'
import { voiceGuide, draftSchema, draftPrompt } from '../src/pipeline/drafter.js'
import { BANNED_PHRASES } from '../src/draft/style.js'
import type { Profile } from '../src/profile.js'

const profile = (voice: Partial<Pick<Profile, 'voiceSample' | 'voiceNotes'>> = {}): Profile => ({
  name: 'Jeremiah Ekanem',
  email: 'j@x.com',
  location: 'Lagos, Nigeria',
  links: [],
  skills: ['Flutter'],
  experience: [],
  education: [],
  screening: {},
  ...voice,
})

const SAMPLE = 'We shipped the offline sync in a week. It was ugly but it held.'

const job = {
  id: 1,
  external_key: 'gh:acme:1',
  title: 'Senior Flutter Engineer',
  company: 'Acme',
  description: 'Build Flutter apps.',
  apply_url: 'https://example.com/1',
  source: 'greenhouse',
  lane: 'remote-mobile',
}

describe('voiceGuide', () => {
  it('falls back to the house style when nothing is stored', () => {
    const guide = voiceGuide(profile())
    expect(guide).toContain('Plain, direct sentences')
    expect(guide).not.toContain('WRITING SAMPLE')
  })

  it('quotes the sample and asks the model to match its rhythm', () => {
    const guide = voiceGuide(profile({ voiceSample: SAMPLE }))
    expect(guide).toContain('WRITING SAMPLE')
    expect(guide).toContain(SAMPLE)
    expect(guide).toMatch(/match the rhythm/i)
  })

  it('names the sample as style-only so it is never mined for facts', () => {
    const guide = voiceGuide(profile({ voiceSample: 'I shipped 40 releases at Acme.' }))
    expect(guide).toMatch(/NOT a source of facts/i)
  })

  it('carries voice notes through when present', () => {
    const guide = voiceGuide(profile({ voiceSample: SAMPLE, voiceNotes: 'never open with a question' }))
    expect(guide).toContain('never open with a question')
  })

  it('ignores a sample that is only whitespace', () => {
    const guide = voiceGuide(profile({ voiceSample: '   \n  ' }))
    expect(guide).not.toContain('WRITING SAMPLE')
  })

  it('keeps the banned-phrase list in force whether or not a sample exists', () => {
    for (const guide of [voiceGuide(profile()), voiceGuide(profile({ voiceSample: SAMPLE }))]) {
      for (const phrase of BANNED_PHRASES) expect(guide).toContain(phrase)
      expect(guide).toContain('120-180 words')
    }
  })
})

describe('draftSchema needs_you', () => {
  it('defaults to false when the model omits it', () => {
    const parsed = draftSchema.parse({
      cover_letter: 'hello',
      answers: [{ question: 'Notice period?', answer: 'Two weeks.' }],
    })
    expect(parsed.answers[0].needs_you).toBe(false)
  })

  it('keeps the flag when the model reports a gap', () => {
    const parsed = draftSchema.parse({
      cover_letter: 'hello',
      answers: [{ question: 'Salary?', answer: 'My profile does not state one.', needs_you: true }],
    })
    expect(parsed.answers[0].needs_you).toBe(true)
  })
})

describe('draftPrompt', () => {
  it('tells the model when to raise needs_you', () => {
    const prompt = draftPrompt(profile(), job, ['What is your notice period?'])
    expect(prompt).toMatch(/"needs_you": true/)
    expect(prompt).toContain('"needs_you": boolean')
  })

  it('separates fact questions from motivation questions', () => {
    const prompt = draftPrompt(profile(), job, ['Why do you want to work here?'])
    expect(prompt).toMatch(/FACT about the candidate/i)
    expect(prompt).toMatch(/why he wants the role or company/i)
  })

  it('reserves needs_you for missing facts, not for motivation', () => {
    const prompt = draftPrompt(profile(), job, ['Why do you want to work here?'])
    expect(prompt).toMatch(/motivation[\s\S]{0,400}"needs_you": false/i)
  })

  it('asks for the missing-fact note in first person', () => {
    const prompt = draftPrompt(profile(), job, ['What is your notice period?'])
    expect(prompt).toMatch(/first person/i)
  })
})
