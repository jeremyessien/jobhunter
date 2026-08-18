import { redirect } from 'next/navigation'
import { auth } from '../auth'
import { isAllowed } from './allowlist'

export async function requireSession() {
  const session = await auth()
  if (!isAllowed(session?.user?.email)) redirect('/signin')
  return session
}
