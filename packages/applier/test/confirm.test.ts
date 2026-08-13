import { describe, expect, it } from 'vitest'
import { confirmationSeen, decideOutcome, isConfirmationUrl } from '../src/confirm'

describe('isConfirmationUrl', () => {
  it('recognizes greenhouse confirmation urls, hosted or embedded', () => {
    expect(isConfirmationUrl('https://boards.greenhouse.io/acme/jobs/123/confirmation')).toBe(true)
    expect(isConfirmationUrl('https://job-boards.greenhouse.io/acme/jobs/123#confirmation')).toBe(true)
    expect(isConfirmationUrl('https://boards.greenhouse.io/embed/job_app/confirmation?for=brex')).toBe(true)
  })
  it('rejects the plain application url', () => {
    expect(isConfirmationUrl('https://boards.greenhouse.io/acme/jobs/123')).toBe(false)
    expect(isConfirmationUrl('https://www.brex.com/careers/123?gh_jid=123')).toBe(false)
  })
})

describe('confirmationSeen', () => {
  it('detects a confirmation in any frame, even when the top url never changes', () => {
    const frames = [
      'https://www.brex.com/careers/123?gh_jid=123',
      'https://consent-sync.brex.com/consent-manager/x',
      'https://boards.greenhouse.io/embed/job_app/confirmation?for=brex',
    ]
    expect(confirmationSeen(frames)).toBe(true)
  })
  it('stays false while the form is still open', () => {
    expect(
      confirmationSeen(['https://www.brex.com/careers/123?gh_jid=123', 'https://boards.greenhouse.io/embed/job_app?for=brex']),
    ).toBe(false)
  })
})

describe('decideOutcome', () => {
  it('maps keys to outcomes', () => {
    expect(decideOutcome('s')).toBe('user-submitted')
    expect(decideOutcome('k')).toBe('skip')
    expect(decideOutcome('x')).toBe('not-applied')
    expect(decideOutcome('q')).toBeNull()
    expect(decideOutcome('')).toBeNull()
  })
})