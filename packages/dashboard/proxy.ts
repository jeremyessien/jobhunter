import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Proxy runs before render and must not depend on shared modules, so this is an
// optimistic cookie-presence check only. Real verification happens in
// lib/session.ts, next to the data.
const SESSION_COOKIES = ['authjs.session-token', '__Secure-authjs.session-token']

export default function proxy(req: NextRequest) {
  const signedIn = SESSION_COOKIES.some((name) => req.cookies.has(name))
  if (signedIn) return NextResponse.next()
  const signin = new URL('/signin', req.url)
  signin.searchParams.set('from', req.nextUrl.pathname)
  return NextResponse.redirect(signin)
}

export const config = {
  matcher: ['/((?!api/auth|signin|_next/static|_next/image|favicon.ico).*)'],
}
