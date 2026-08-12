import { getDb } from '../../lib/db'
import { sourceHealth } from '../../lib/data'
import { Nav } from '../nav'

export const dynamic = 'force-dynamic'

export default async function HealthPage() {
  const db = await getDb()
  const sources = await sourceHealth(db)
  if (sources.length === 0)
    return (
      <>
        <Nav active="health" />
        <main>
          <p>No hunts recorded yet.</p>
        </main>
      </>
    )
  return (
    <>
      <Nav active="health" />
      <main>
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Last run</th>
              <th>Last success</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.source}>
                <td>{s.source}</td>
                <td>{s.lastRun}</td>
                <td>{s.lastOk ?? 'never'}</td>
                <td>
                  {s.warning ? (
                    <span className="badge warn">{s.consecutiveFailures} consecutive failures</span>
                  ) : (
                    <span className="badge ready">ok</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </>
  )
}
