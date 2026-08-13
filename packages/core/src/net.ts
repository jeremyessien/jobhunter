const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export function makeThrottledFetch(opts?: {
  minIntervalMs?: number
  sleep?: (ms: number) => Promise<void>
  fetchImpl?: typeof fetch
}) {
  const minInterval = opts?.minIntervalMs ?? 1000
  const sleep = opts?.sleep ?? realSleep
  const fetchImpl = opts?.fetchImpl ?? fetch
  const lastCall = new Map<string, number>()

  return async function fetchJson(url: string): Promise<unknown> {
    const host = new URL(url).hostname
    const wait = (lastCall.get(host) ?? 0) + minInterval - Date.now()
    if (wait > 0) await sleep(wait)
    lastCall.set(host, Date.now())

    for (const backoff of [2000, 8000, null]) {
      const res = await fetchImpl(url, { headers: { accept: 'application/json' } })
      if (res.ok) return res.json()
      if (res.status === 429 && backoff !== null) {
        await sleep(backoff)
        continue
      }
      throw new Error(`GET ${url} failed: ${res.status}`)
    }
    throw new Error(`GET ${url} failed: unreachable`)
  }
}
