import { describe, it, expect } from 'vitest'
import { factLock, extractNumbers } from '../src/draft/facts.js'

const profile = JSON.stringify({
  name: 'Jeremiah Ekanem',
  skills: ['Flutter'],
  experience: [
    { company: 'Heirs', title: 'Senior Flutter Engineer', start: '2026-02', end: null, highlights: ['Cold start 11.4s to 2.1s', '195 tests', 'lock screen 1,440ms to 119ms'] },
  ],
})
const jd = 'We need 5+ years of Flutter experience. Salary $120k-$150k.'
const sources = [profile, jd]

describe('extractNumbers', () => {
  it('normalizes commas and captures decimals', () => {
    expect(extractNumbers('from 1,440ms down to 11.4s')).toEqual(['1440', '11.4'])
  })
})

describe('factLock', () => {
  it('passes a draft whose numbers all come from the profile', () => {
    expect(factLock('I cut cold start from 11.4s to 2.1s and wrote 195 tests.', sources)).toEqual([])
  })

  it('passes numbers that appear only in the job posting', () => {
    expect(factLock('You ask for 5 years; my track record covers exactly that.', sources)).toEqual([])
  })

  it('catches a fabricated percentage', () => {
    const violations = factLock('I improved performance by 82%.', sources)
    expect(violations).toEqual([expect.stringContaining('82')])
  })

  it('catches fabricated years-of-experience claims', () => {
    const violations = factLock('I have 9 years of Flutter experience.', sources)
    expect(violations).toEqual([expect.stringContaining('9')])
  })

  it('matches comma-formatted numbers against their plain form', () => {
    expect(factLock('I took the lock screen from 1440ms to 119ms.', sources)).toEqual([])
  })

  it('passes drafts with no numbers at all', () => {
    expect(factLock('I build reliable mobile apps for banks.', sources)).toEqual([])
  })

  it('catches a fabricated leading-dot decimal instead of colliding with a bare digit', () => {
    const violations = factLock('I shaved .5 seconds off cold start times.', sources)
    expect(violations).toEqual([expect.stringContaining('0.5')])
  })

  it('treats a leading-dot decimal as equal to its zero-prefixed form', () => {
    expect(factLock('I shaved .5 seconds off cold start times.', ['Baseline latency was 0.5s.'])).toEqual([])
  })
})
