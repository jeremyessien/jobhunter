export const BANNED_PHRASES = [
  'i am thrilled',
  'i am excited',
  'i am delighted',
  'i am writing to express',
  'excited to apply',
  'thrilled to',
  'delve',
  'leverage',
  'leveraging',
  'passionate about',
  'cutting-edge',
  'fast-paced environment',
  'hit the ground running',
  'proven track record',
  'wealth of experience',
  'results-driven',
  'perfect fit',
  'aligns perfectly',
  'unique blend',
  'spearheaded',
  'esteemed',
  'utilize',
  'synergy',
] as const

const BANNED_CHARS: [RegExp, string][] = [
  [/—/g, 'em-dash'],
  [/–/g, 'en-dash'],
]

const EMOJI = /\p{Extended_Pictographic}/gu

export function styleLint(text: string): string[] {
  const violations: string[] = []
  for (const [re, name] of BANNED_CHARS) {
    const count = (text.match(re) ?? []).length
    if (count > 0) violations.push(`${name} used ${count}x`)
  }
  const emojis = text.match(EMOJI)
  if (emojis) violations.push(`emoji: ${[...new Set(emojis)].join(' ')}`)
  const lower = text.toLowerCase()
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) violations.push(`banned phrase: "${phrase}"`)
  }
  return violations
}
