import { describe, it, expect } from 'vitest'
import { styleLint } from '../src/draft/style.js'

describe('styleLint', () => {
  it('passes plain human text', () => {
    const text =
      "I've spent the last year rebuilding UBA's mobile app performance. Cold start went from 11.4s to 2.1s. I'd bring the same discipline to your Flutter team."
    expect(styleLint(text)).toEqual([])
  })

  it('catches em-dashes and en-dashes', () => {
    const violations = styleLint('I build apps — fast ones – for banks.')
    expect(violations.some((v) => v.includes('em-dash'))).toBe(true)
    expect(violations.some((v) => v.includes('en-dash'))).toBe(true)
  })

  it('catches emojis', () => {
    const violations = styleLint('Excited to apply! \u{1F680}')
    expect(violations.some((v) => v.includes('emoji'))).toBe(true)
  })

  it('catches banned phrases case-insensitively', () => {
    const violations = styleLint('I am THRILLED to Leverage my skills and delve into this role.')
    expect(violations).toContainEqual(expect.stringContaining('i am thrilled'))
    expect(violations).toContainEqual(expect.stringContaining('leverage'))
    expect(violations).toContainEqual(expect.stringContaining('delve'))
  })

  it('reports every violation, not just the first', () => {
    const violations = styleLint('I am thrilled — truly passionate about this cutting-edge role \u{1F389}')
    expect(violations.length).toBeGreaterThanOrEqual(4)
  })
})
