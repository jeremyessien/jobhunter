import { describe, expect, it } from 'vitest'
import { timeAgo } from '../app/format'

const now = new Date('2026-08-12T12:00:00.000Z')

describe('timeAgo', () => {
  it('says just now under a minute', () => {
    expect(timeAgo('2026-08-12T11:59:30.000Z', now)).toBe('just now')
  })
  it('reports minutes', () => {
    expect(timeAgo('2026-08-12T11:15:00.000Z', now)).toBe('45m ago')
  })
  it('reports hours', () => {
    expect(timeAgo('2026-08-12T09:00:00.000Z', now)).toBe('3h ago')
  })
  it('reports days under two weeks', () => {
    expect(timeAgo('2026-08-05T12:00:00.000Z', now)).toBe('7d ago')
  })
  it('falls back to the date beyond two weeks', () => {
    expect(timeAgo('2026-07-01T12:00:00.000Z', now)).toBe('2026-07-01')
  })
  it('treats future timestamps as just now', () => {
    expect(timeAgo('2026-08-12T12:05:00.000Z', now)).toBe('just now')
  })
  it('returns unparseable input unchanged', () => {
    expect(timeAgo('never', now)).toBe('never')
  })
})
