import { describe, it, expect } from 'vitest'
import { makeThrottledFetch } from '../src/net.js'

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as Response

describe('makeThrottledFetch', () => {
  it('spaces requests to the same host by minIntervalMs', async () => {
    const sleeps: number[] = []
    const f = makeThrottledFetch({
      minIntervalMs: 1000,
      sleep: async (ms) => { sleeps.push(ms) },
      fetchImpl: (() => Promise.resolve(okResponse({ a: 1 }))) as typeof fetch,
    })
    await f('https://api.example.com/one')
    await f('https://api.example.com/two')
    await f('https://other.example.org/three')
    expect(sleeps.length).toBe(1)
    expect(sleeps[0]).toBeGreaterThan(0)
    expect(sleeps[0]).toBeLessThanOrEqual(1000)
  })

  it('retries on 429 with backoff then succeeds', async () => {
    let calls = 0
    const sleeps: number[] = []
    const f = makeThrottledFetch({
      minIntervalMs: 0,
      sleep: async (ms) => { sleeps.push(ms) },
      fetchImpl: (() => {
        calls++
        return Promise.resolve(calls < 3 ? ({ ok: false, status: 429 } as Response) : okResponse({ done: true }))
      }) as typeof fetch,
    })
    expect(await f('https://api.example.com/x')).toEqual({ done: true })
    expect(sleeps).toEqual([2000, 8000])
  })

  it('throws on non-200 non-429', async () => {
    const f = makeThrottledFetch({
      minIntervalMs: 0,
      sleep: async () => {},
      fetchImpl: (() => Promise.resolve({ ok: false, status: 404 } as Response)) as typeof fetch,
    })
    await expect(f('https://api.example.com/x')).rejects.toThrow('404')
  })
})
