export function isAllowed(email: string | null | undefined): boolean {
  const allowed = (process.env.JOBHUNTER_ALLOWED_EMAIL ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
  if (allowed.length === 0 || !email) return false
  return allowed.includes(email.trim().toLowerCase())
}
