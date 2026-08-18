import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import { isAllowed } from './lib/allowlist'

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  pages: { signIn: '/signin' },
  callbacks: {
    signIn: ({ profile }) => isAllowed(profile?.email),
    session: ({ session }) => session,
  },
})
