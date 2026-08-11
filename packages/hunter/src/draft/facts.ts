const NUMBER = /\d+(?:[.,]\d+)*/g

const normalize = (token: string) => token.replace(/,/g, '')

export function extractNumbers(text: string): string[] {
  return [...new Set((text.match(NUMBER) ?? []).map(normalize))]
}

export function factLock(draft: string, allowedSources: string[]): string[] {
  const allowed = new Set(allowedSources.flatMap(extractNumbers))
  return extractNumbers(draft)
    .filter((n) => !allowed.has(n))
    .map((n) => `number ${n} appears in neither the profile nor the job posting`)
}
