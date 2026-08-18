import { getDb } from '../../lib/db'
import { sourceHealth } from '../../lib/data'
import { Nav } from '../nav'
import { timeAgo } from '../format'
import { requireSession } from '../../lib/session'

export const dynamic = 'force-dynamic'

export default async function HealthPage() {
  await requireSession()
  const db = await getDb()
  const sources = await sourceHealth(db)
  const lastHunt = sources.map((s) => s.lastRun).sort().at(-1)
  const failing = sources.filter((s) => s.warning)
  return (
    <>
      <Nav active="health" />
      <main>
        <div className="page-head">
          <h1>Sources</h1>
          <span className="sub">{lastHunt ? `last hunt ${timeAgo(lastHunt)}` : 'no hunts yet'}</span>
        </div>
        <p className="desc">
          The job boards this tool pulls from. A source turns red after 3 failed runs in a row — the rest keep working
          without it.
        </p>
        {sources.length === 0 && (
          <div className="empty">
            <span className="status-dot" />
            <p>No hunts recorded yet</p>
            <p className="hint">
              in a terminal, run <code>pnpm jobhunter hunt</code> to start pulling jobs
            </p>
          </div>
        )}
        {failing.length > 0 && (
          <div className="notice-err">
            <strong>Sources failing</strong>
            <ul>
              {failing.map((s) => (
                <li key={s.source}>
                  {s.source}: {s.consecutiveFailures} consecutive failures
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="health-list">
          {sources.map((s) => {
            const budget = Math.max(0, 3 - s.consecutiveFailures)
            const width = s.consecutiveFailures >= 3 ? '100%' : `${Math.round((budget / 3) * 100)}%`
            const barClass = s.consecutiveFailures >= 3 ? 'bad-bar' : s.consecutiveFailures > 0 ? 'warn-bar' : ''
            return (
              <div className="health-row" key={s.source}>
                <span className={`status-dot ${s.warning ? 'bad' : 'ok'}`} />
                <span className="source">{s.source}</span>
                <span className="bar" aria-hidden="true">
                  <span className={barClass} style={{ width }} />
                </span>
                <span className="meta mono">
                  {s.lastOk ? `ok ${timeAgo(s.lastOk)}` : 'never ok'} · ran {timeAgo(s.lastRun)}
                </span>
              </div>
            )
          })}
        </div>
      </main>
    </>
  )
}
