const NUMBER = /\d*\.\d+|\d+(?:[.,]\d+)*/g

const normalize = (token: string) => {
  const stripped = token.replace(/,/g, '')
  return stripped.startsWith('.') ? `0${stripped}` : stripped
}

export function extractNumbers(text: string): string[] {
  return [...new Set((text.match(NUMBER) ?? []).map(normalize))]
}

export function factLock(draft: string, allowedSources: string[]): string[] {
  const allowed = new Set(allowedSources.flatMap(extractNumbers))
  return extractNumbers(draft)
    .filter((n) => !allowed.has(n))
    .map((n) => `number ${n} does not appear in any allowed source text`)
}
