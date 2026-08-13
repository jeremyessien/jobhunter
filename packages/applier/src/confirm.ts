export type WaitOutcome = 'confirmed' | 'user-submitted' | 'skip' | 'not-applied'

export function isConfirmationUrl(url: string): boolean {
  return /greenhouse\.io\/.*confirmation/.test(url)
}

export function confirmationSeen(frameUrls: string[]): boolean {
  return frameUrls.some(isConfirmationUrl)
}

export function decideOutcome(key: string): WaitOutcome | null {
  if (key === 's') return 'user-submitted'
  if (key === 'k') return 'skip'
  if (key === 'x') return 'not-applied'
  return null
}