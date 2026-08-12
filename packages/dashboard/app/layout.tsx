import './globals.css'
import Link from 'next/link'
import { Inter, JetBrains_Mono } from 'next/font/google'
import type { ReactNode } from 'react'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata = { title: 'jobhunter' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>
        <nav className="legacy-nav">
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
