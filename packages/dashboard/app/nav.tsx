import Link from 'next/link'
import type { ReactNode } from 'react'

export type PageId = 'queue' | 'tracker' | 'health' | 'settings'

const icon = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)

const items: { id: PageId; href: string; label: string; glyph: ReactNode }[] = [
  {
    id: 'queue',
    href: '/',
    label: 'Queue',
    glyph: icon(
      <>
        <path d="M22 12h-6l-2 3h-4l-2-3H2" />
        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      </>,
    ),
  },
  {
    id: 'tracker',
    href: '/tracker',
    label: 'Tracker',
    glyph: icon(
      <>
        <line x1="22" y1="2" x2="11" y2="13" />
        <polygon points="22 2 15 22 11 13 2 9 22 2" />
      </>,
    ),
  },
  {
    id: 'health',
    href: '/health',
    label: 'Health',
    glyph: icon(<polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />),
  },
  {
    id: 'settings',
    href: '/settings',
    label: 'Settings',
    glyph: icon(
      <>
        <line x1="4" y1="21" x2="4" y2="14" />
        <line x1="4" y1="10" x2="4" y2="3" />
        <line x1="12" y1="21" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12" y2="3" />
        <line x1="20" y1="21" x2="20" y2="16" />
        <line x1="20" y1="12" x2="20" y2="3" />
        <line x1="1" y1="14" x2="7" y2="14" />
        <line x1="9" y1="8" x2="15" y2="8" />
        <line x1="17" y1="16" x2="23" y2="16" />
      </>,
    ),
  },
]

export function Nav({ active }: { active: PageId }) {
  return (
    <>
      <header className="topbar">
        <span className="wordmark">
          <span className="dot" />
          JOBHUNTER
        </span>
        <nav className="topbar-nav">
          {items.map((i) => (
            <Link key={i.id} href={i.href} aria-current={i.id === active ? 'page' : undefined}>
              {i.label}
            </Link>
          ))}
        </nav>
      </header>
      <nav className="tabbar">
        {items.map((i) => (
          <Link key={i.id} href={i.href} aria-current={i.id === active ? 'page' : undefined}>
            {i.glyph}
            {i.label}
          </Link>
        ))}
      </nav>
    </>
  )
}
