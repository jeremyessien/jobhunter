import './globals.css'
import Link from 'next/link'
import type { ReactNode } from 'react'

export const metadata = { title: 'jobhunter' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <Link href="/">Queue</Link>
          <Link href="/tracker">Tracker</Link>
          <Link href="/health">Health</Link>
          <Link href="/settings">Settings</Link>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  )
}
