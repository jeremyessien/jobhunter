import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isAllowed } from '../lib/allowlist.js'

const original = process.env.JOBHUNTER_ALLOWED_EMAIL

beforeEach(() => {
  process.env.JOBHUNTER_ALLOWED_EMAIL = 'huncklejeremy@gmail.com'
})
afterEach(() => {
  if (original === undefined) delete process.env.JOBHUNTER_ALLOWED_EMAIL
  else process.env.JOBHUNTER_ALLOWED_EMAIL = original
})

describe('isAllowed', () => {
  it('allows the configured address', () => {
    expect(isAllowed('huncklejeremy@gmail.com')).toBe(true)
  })

  it('ignores case and surrounding whitespace', () => {
    expect(isAllowed('  HuncklEJeremy@Gmail.COM ')).toBe(true)
  })

  it('rejects any other address', () => {
    expect(isAllowed('someone@else.com')).toBe(false)
    expect(isAllowed('huncklejeremy@gmail.com.attacker.com')).toBe(false)
    expect(isAllowed('xhuncklejeremy@gmail.com')).toBe(false)
  })

  it('rejects a missing address', () => {
    expect(isAllowed(null)).toBe(false)
    expect(isAllowed(undefined)).toBe(false)
    expect(isAllowed('')).toBe(false)
  })

  it('fails closed when the allowlist is unset', () => {
    delete process.env.JOBHUNTER_ALLOWED_EMAIL
    expect(isAllowed('huncklejeremy@gmail.com')).toBe(false)
  })

  it('fails closed when the allowlist is blank', () => {
    process.env.JOBHUNTER_ALLOWED_EMAIL = '   '
    expect(isAllowed('huncklejeremy@gmail.com')).toBe(false)
  })

  it('supports several addresses when configured', () => {
    process.env.JOBHUNTER_ALLOWED_EMAIL = 'a@x.com, huncklejeremy@gmail.com'
    expect(isAllowed('a@x.com')).toBe(true)
    expect(isAllowed('huncklejeremy@gmail.com')).toBe(true)
    expect(isAllowed('b@x.com')).toBe(false)
  })
})
