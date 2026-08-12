import { getDb } from '../../lib/db'
import { sourceHealth } from '../../lib/data'
import { Nav } from '../nav'
import { timeAgo } from '../format'

export const dynamic = 'force-dynamic'

export default async function HealthPage() {
  const db = await getDb()
  const sources = await sourceHealth(db)
  const lastHunt = sources.map((s) => s.lastRun).sort().at(-1)
  const failing = sources.filter((s) => s.warning)
  return (
    <>
      <Nav active="health" />
      <main>
        <div className="page-head">
          <h1>Health</h1>
          <span className="sub">{lastHunt ? `last hunt ${timeAgo(lastHunt)}` : 'no hunts yet'}</span>
        </div>
        {sources.length === 0 && (
          <div className="empty">
            <span className="status-dot" />
            <p>No hunts recorded yet</p>
            <p className="hint">run a hunt to see source health</p>
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
