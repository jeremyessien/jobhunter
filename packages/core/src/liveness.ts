export type Liveness = 'live' | 'gone' | 'unknown'

const DEAD_STATUSES = new Set([404, 410])

const LISTING_SEGMENTS = new Set([
  'search', 'jobs', 'careers', 'career', 'positions', 'openings', 'vacancies', 'listings', 'all', 'index',
])

// an expired posting is rarely a 404: aggregators redirect to their listing index
// and ATS boards to the employer's search page, both answering 200. So a 200 only
// counts when the destination still points at one specific posting.
const isSpecificPath = (url: string) => {
  const segments = new URL(url).pathname.split('/').filter(Boolean)
  if (segments.length < 2) return false
  return !LISTING_SEGMENTS.has(segments[segments.length - 1].toLowerCase())
}

export async function checkPosting(url: string, fetchImpl: typeof fetch = fetch): Promise<Liveness> {
  if (!/^https?:\/\//i.test(url)) return 'unknown'
  try {
    const res = await fetchImpl(url, { method: 'HEAD', redirect: 'follow' })
    if (DEAD_STATUSES.has(res.status)) return 'gone'
    if (res.status !== 200) return 'unknown'
    return isSpecificPath(res.url || url) ? 'live' : 'gone'
  } catch {
    return 'unknown'
  }
}
