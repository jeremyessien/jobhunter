import { getDb } from '../../lib/db'
import { trackerJobs, laneStats } from '../../lib/data'
import { respond, reject } from './actions'
import { Nav } from '../nav'

export const dynamic = 'force-dynamic'

export default async function TrackerPage() {
  const db = await getDb()
  const [jobs, stats] = await Promise.all([trackerJobs(db), laneStats(db)])
  return (
    <>
      <Nav active="tracker" />
      <main>
        <h2>Applications</h2>
        {jobs.length === 0 && <p>Nothing submitted yet.</p>}
        <table>
          <thead>
            <tr>
              <th>Job</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td>
                  {j.title}
                  <div className="meta">
                    {j.company} · {j.lane} · sent {j.submittedAt}
                  </div>
                </td>
                <td>
                  <span className={j.status === 'responded' ? 'badge ready' : j.status === 'rejected' ? 'badge warn' : 'badge'}>
                    {j.status}
                  </span>
                </td>
                <td>
                  {j.status === 'submitted' && (
                    <div className="actions">
                      <form action={respond}>
                        <input type="hidden" name="id" value={j.id} />
                        <button>Responded</button>
                      </form>
                      <form action={reject}>
                        <input type="hidden" name="id" value={j.id} />
                        <button>Rejected</button>
                      </form>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2>Per-lane response rate</h2>
        <table>
          <thead>
            <tr>
              <th>Lane</th>
              <th>Submitted</th>
              <th>Responded</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.lane}>
                <td>{s.lane}</td>
                <td>{s.submitted}</td>
                <td>{s.responded}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </>
  )
}
